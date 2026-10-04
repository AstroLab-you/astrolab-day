package you.astrolab.day;

import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;

import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * ===== УЧЁТ ШАГОВ ПО ДНЯМ =====
 *
 * Шаги считает сам телефон: датчик TYPE_STEP_COUNTER живёт в чипе датчиков
 * и копит число шагов с последней перезагрузки, пока приложение не запущено.
 * Мы его только читаем — при открытии приложения и по будильнику сразу после
 * полуночи (StepsReceiver). Отсюда две задачи этого класса:
 *
 *  1. Граница суток. Датчик отдаёт одно накопительное число, поэтому в
 *     памяти хранится «база» — показание на начало текущего дня; шаги дня =
 *     показание − база. Если чтение пропустило полночь (будильник не
 *     сработал, телефон был выключен), шаги между двумя чтениями делятся
 *     между днями пропорционально времени — для игры этой точности хватает.
 *  2. Перезагрузка. После неё счётчик начинается с нуля; это видно по
 *     времени загрузки системы. Шаги с прошлого чтения до выключения
 *     теряются — восстановить их неоткуда.
 *
 * Всё хранится в SharedPreferences и телефон не покидает: шаги — данные о
 * здоровье, на сервер они не уходят, как и данные рождения.
 */
final class StepStore {
    private static final String PREFS = "steps";
    private static final String K_DAY = "day", K_BASE = "base", K_LAST = "last", K_LAST_AT = "lastAt", K_BOOT = "boot", K_HIST = "hist";
    /** сколько прошлых дней помнить — для будущих правил игры */
    private static final int HIST_DAYS = 60;
    /** время загрузки системы дрейфует на доли секунды; перезагрузка сдвигает его на минуты */
    private static final long REBOOT_GAP_MS = 60_000;

    static final class Result {
        boolean sensor;      // есть ли в телефоне счётчик шагов
        long steps;          // шаги за сегодня
        String day;          // сегодняшняя дата, ГГГГ-ММ-ДД
        long readAt;         // когда датчик читали в последний раз, мс эпохи (0 — ни разу)
        JSONObject history;  // прошлые дни: дата → шаги
    }

    private StepStore() {}

    /** Читает датчик и пересчитывает день. Блокирует поток до ответа датчика (до ~4 с), звать не из главного. */
    static synchronized Result update(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        long bootNow = now - SystemClock.elapsedRealtime();
        String today = ymd(now);
        long counter = readCounter(ctx, 4000);

        Result r = new Result();
        r.sensor = hasSensor(ctx);
        r.day = today;
        r.history = history(p);
        r.readAt = p.getLong(K_LAST_AT, 0);
        if (counter < 0) {
            // датчика нет или он не ответил — отдаём, что помним
            r.steps = today.equals(p.getString(K_DAY, null)) ? Math.max(0, p.getLong(K_LAST, 0) - p.getLong(K_BASE, 0)) : 0;
            return r;
        }

        String day = p.getString(K_DAY, null);
        long steps;
        if (day == null) {
            // первое чтение: с этого момента и считаем, шаги раньше по дню неизвестны
            steps = 0;
        } else {
            long base = p.getLong(K_BASE, 0), last = p.getLong(K_LAST, 0), lastAt = p.getLong(K_LAST_AT, now), boot = p.getLong(K_BOOT, bootNow);
            boolean rebooted = Math.abs(bootNow - boot) > REBOOT_GAP_MS;
            long prevSteps = Math.max(0, last - base);                   // шаги сохранённого дня до прошлого чтения
            long delta = rebooted ? counter : Math.max(0, counter - last); // новые шаги с прошлого чтения
            long from = rebooted ? Math.max(lastAt, bootNow) : lastAt;    // после перезагрузки новые шаги — только с момента загрузки
            if (today.equals(day)) {
                steps = prevSteps + delta;
            } else {
                // чтение перешагнуло полночь: делим новые шаги между днями по времени
                long span = Math.max(1, now - from);
                long assigned = 0;
                long dayEnd = nextMidnight(from);
                long share = Math.round(delta * (double) Math.max(0, Math.min(dayEnd, now) - from) / span);
                putHistory(r.history, day, prevSteps + share);
                assigned += share;
                long todayStart = startOfDay(now);
                for (long d = dayEnd; d < todayStart; d = nextMidnight(d)) {
                    long s = Math.round(delta * (double) (nextMidnight(d) - d) / span);
                    putHistory(r.history, ymd(d), s);
                    assigned += s;
                }
                steps = Math.max(0, delta - assigned);
            }
        }
        trimHistory(r.history);
        p.edit()
            .putString(K_DAY, today)
            .putLong(K_BASE, counter - steps)
            .putLong(K_LAST, counter)
            .putLong(K_LAST_AT, now)
            .putLong(K_BOOT, bootNow)
            .putString(K_HIST, r.history.toString())
            .apply();
        r.steps = steps;
        r.readAt = now;
        return r;
    }

    static boolean hasSensor(Context ctx) {
        SensorManager sm = (SensorManager) ctx.getSystemService(Context.SENSOR_SERVICE);
        return sm != null && sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null;
    }

    /**
     * Текущее показание счётчика или −1. Датчик «по изменению»: при подписке
     * он сразу присылает текущее значение, поэтому подписываемся, ждём первое
     * событие и отписываемся.
     */
    static long readCounter(Context ctx, long timeoutMs) {
        SensorManager sm = (SensorManager) ctx.getSystemService(Context.SENSOR_SERVICE);
        Sensor sensor = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        if (sensor == null) return -1;
        HandlerThread thread = new HandlerThread("steps-read");
        thread.start();
        final CountDownLatch latch = new CountDownLatch(1);
        final long[] out = { -1 };
        SensorEventListener listener = new SensorEventListener() {
            @Override public void onSensorChanged(SensorEvent e) {
                if (e.values != null && e.values.length > 0) out[0] = (long) e.values[0];
                latch.countDown();
            }
            @Override public void onAccuracyChanged(Sensor s, int accuracy) {}
        };
        try {
            if (sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_FASTEST, new Handler(thread.getLooper())))
                latch.await(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        } finally {
            sm.unregisterListener(listener);
            thread.quitSafely();
        }
        return out[0];
    }

    // ===== КАЛЕНДАРЬ ===== (часовой пояс телефона, как и «сегодня» на экране дня)

    static String ymd(long ms) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date(ms));
    }

    static long startOfDay(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** начало следующих суток; через Calendar, чтобы перевод часов не сдвигал полночь */
    static long nextMidnight(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(startOfDay(ms));
        c.add(Calendar.DAY_OF_MONTH, 1);
        return c.getTimeInMillis();
    }

    // ===== ИСТОРИЯ ПО ДНЯМ =====

    private static JSONObject history(SharedPreferences p) {
        try { return new JSONObject(p.getString(K_HIST, "{}")); }
        catch (JSONException e) { return new JSONObject(); }
    }

    private static void putHistory(JSONObject h, String day, long steps) {
        try { h.put(day, steps); } catch (JSONException ignored) {}
    }

    private static void trimHistory(JSONObject h) {
        if (h.length() <= HIST_DAYS) return;
        List<String> keys = new ArrayList<>();
        for (Iterator<String> it = h.keys(); it.hasNext();) keys.add(it.next());
        Collections.sort(keys);   // даты ГГГГ-ММ-ДД сортируются как строки
        for (int i = 0; i < keys.size() - HIST_DAYS; i++) h.remove(keys.get(i));
    }
}
