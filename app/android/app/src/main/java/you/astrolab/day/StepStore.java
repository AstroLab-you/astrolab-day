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

import org.json.JSONArray;
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
 * ===== УЧЁТ ШАГОВ ПО ЧАСАМ =====
 *
 * Шаги считает сам телефон: датчик TYPE_STEP_COUNTER живёт в чипе датчиков
 * и копит число шагов с последней перезагрузки, пока приложение не запущено.
 * Мы его только читаем — при открытии меню и по будильнику в начале каждого
 * часа (StepsReceiver). Шаги между двумя чтениями раскладываются по часам
 * пропорционально времени; сутки — сумма своих часов.
 *
 *  • Чтения раз в час — каждый час точный. Будильник опоздал или телефон
 *    его придержал (экономия батареи) — шаги промежутка размазаны по его
 *    часам, такие часы помечены как оценка: на графике их видно, и понятно,
 *    где число может врать.
 *  • Перезагрузка: счётчик после неё с нуля; узнаём её по времени загрузки
 *    системы. Шаги с прошлого чтения до выключения теряются.
 *
 * Всё хранится в SharedPreferences и телефон не покидает: шаги — данные о
 * здоровье, на сервер они не уходят, как и данные рождения.
 */
final class StepStore {
    private static final String PREFS = "steps";
    private static final String K_LAST = "last", K_LAST_AT = "lastAt", K_BOOT = "boot", K_SINCE = "since",
        K_HOURS = "hours", K_EST = "est", K_HIST = "hist";
    // ключи версии 0.6.0: сутки целиком, без часов — переносятся при первом чтении
    private static final String K_OLD_DAY = "day", K_OLD_BASE = "base";
    /** сколько дней хранить по часам; старше — только сумма за день */
    private static final int HOUR_DAYS = 8;
    /** сколько дней помнить суммы — для будущих правил игры */
    private static final int HIST_DAYS = 60;
    /** время загрузки системы дрейфует на доли секунды; перезагрузка сдвигает его на минуты */
    private static final long REBOOT_GAP_MS = 60_000;
    /** промежуток между чтениями длиннее этого — часы внутри него только оценка */
    private static final long EXACT_GAP_MS = 75 * 60_000;

    static final class Result {
        boolean sensor;      // есть ли в телефоне счётчик шагов
        long steps;          // шаги за сегодня
        String day;          // сегодняшняя дата, ГГГГ-ММ-ДД
        long readAt;         // когда датчик читали в последний раз, мс эпохи (0 — ни разу)
        long since;          // когда счёт начался (первое чтение после установки)
        JSONObject hours;    // дата → 24 числа: шаги по часам
        JSONObject est;      // дата → 24 флага (0/1): час посчитан оценкой
        JSONObject history;  // дата → шаги за день, и за прошлые дни, и за сегодня
    }

    private StepStore() {}

    /** Читает датчик и раскладывает новые шаги по часам. Блокирует поток до ответа датчика (до ~4 с), звать не из главного. */
    static synchronized Result update(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        long bootNow = now - SystemClock.elapsedRealtime();
        long counter = readCounter(ctx, 4000);
        JSONObject hours = json(p, K_HOURS), est = json(p, K_EST), hist = json(p, K_HIST);
        SharedPreferences.Editor ed = p.edit();

        if (counter >= 0) {
            if (!p.contains(K_LAST_AT)) {
                // первое чтение: с этого момента и считаем, шаги раньше по дню неизвестны
                ed.putLong(K_SINCE, now);
            } else {
                long last = p.getLong(K_LAST, 0), lastAt = p.getLong(K_LAST_AT, now), boot = p.getLong(K_BOOT, bootNow);
                if (!p.contains(K_HOURS) && p.contains(K_OLD_DAY)) migrate(p, hours, est, lastAt);
                boolean rebooted = Math.abs(bootNow - boot) > REBOOT_GAP_MS;
                long delta = rebooted ? counter : Math.max(0, counter - last);   // новые шаги с прошлого чтения
                long from = rebooted ? Math.max(lastAt, bootNow) : lastAt;       // после перезагрузки — только с момента загрузки
                spread(hours, est, delta, from, now, now - from > EXACT_GAP_MS);
            }
            trim(hours, est, hist, now);
            ed.putLong(K_LAST, counter).putLong(K_LAST_AT, now).putLong(K_BOOT, bootNow)
              .putString(K_HOURS, hours.toString()).putString(K_EST, est.toString()).putString(K_HIST, hist.toString())
              .remove(K_OLD_DAY).remove(K_OLD_BASE).apply();
        }

        // ответ: часы — целыми, суммы за дни — из часов (старшие дни — из hist)
        Result r = new Result();
        r.sensor = hasSensor(ctx);
        r.day = ymd(now);
        // apply() меняет память сразу, на диск пишет потом — читаем уже новое
        r.readAt = p.getLong(K_LAST_AT, 0);
        r.since = p.getLong(K_SINCE, 0);
        r.hours = new JSONObject();
        r.est = est;
        r.history = copy(hist);
        for (Iterator<String> it = hours.keys(); it.hasNext();) {
            String d = it.next();
            JSONArray src = hours.optJSONArray(d), out = new JSONArray();
            double sum = 0;
            for (int h = 0; h < 24; h++) { double v = src == null ? 0 : src.optDouble(h, 0); sum += v; out.put(Math.round(v)); }
            put(r.hours, d, out);
            put(r.history, d, Math.round(sum));
        }
        r.steps = r.history.optLong(r.day, 0);
        return r;
    }

    /**
     * Раскладывает delta шагов по часам промежутка [from, to] пропорционально
     * времени. Короткий промежуток внутри одного часа — точный счёт этого часа.
     */
    private static void spread(JSONObject hours, JSONObject est, long delta, long from, long to, boolean estimated) {
        if (delta <= 0) return;
        if (to <= from) { add(hours, est, to, delta, false); return; }
        double span = to - from;
        for (long t = from; t < to;) {
            long end = Math.min(nextHour(t), to);
            add(hours, est, t, delta * (end - t) / span, estimated);
            t = end;
        }
    }

    private static void add(JSONObject hours, JSONObject est, long at, double steps, boolean estimated) {
        String d = ymd(at);
        int h = hourOf(at);
        JSONArray a = array(hours, d, 0), e = array(est, d, 0);
        try {
            a.put(h, a.optDouble(h, 0) + steps);
            if (estimated && steps >= 1) e.put(h, 1);
        } catch (JSONException ignored) {}
    }

    /** Данные версии 0.6.0: шаги сегодняшнего дня без часов — оценкой с полуночи до последнего чтения. */
    private static void migrate(SharedPreferences p, JSONObject hours, JSONObject est, long lastAt) {
        if (!ymd(lastAt).equals(p.getString(K_OLD_DAY, ""))) return;
        long steps = Math.max(0, p.getLong(K_LAST, 0) - p.getLong(K_OLD_BASE, 0));
        spread(hours, est, steps, startOfDay(lastAt), lastAt, true);
    }

    /** Старше HOUR_DAYS дней — из часов в суммы; сумм не больше HIST_DAYS. */
    private static void trim(JSONObject hours, JSONObject est, JSONObject hist, long now) {
        List<String> days = keys(hours);
        for (int i = 0; i < days.size() - HOUR_DAYS; i++) {
            String d = days.get(i);
            JSONArray a = hours.optJSONArray(d);
            double sum = 0;
            for (int h = 0; a != null && h < 24; h++) sum += a.optDouble(h, 0);
            put(hist, d, Math.round(sum));
            hours.remove(d); est.remove(d);
        }
        List<String> old = keys(hist);
        for (int i = 0; i < old.size() - HIST_DAYS; i++) hist.remove(old.get(i));
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

    static int hourOf(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        return c.get(Calendar.HOUR_OF_DAY);
    }

    static long startOfDay(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** начало следующего часа; через Calendar, чтобы перевод часов не сбивал границы */
    static long nextHour(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        c.add(Calendar.HOUR_OF_DAY, 1);
        return c.getTimeInMillis();
    }

    // ===== JSON =====

    private static JSONObject json(SharedPreferences p, String key) {
        try { return new JSONObject(p.getString(key, "{}")); }
        catch (JSONException e) { return new JSONObject(); }
    }

    private static JSONObject copy(JSONObject o) {
        try { return new JSONObject(o.toString()); }
        catch (JSONException e) { return new JSONObject(); }
    }

    /** массив дня на 24 часа; нет — создаётся нулями */
    private static JSONArray array(JSONObject o, String day, int fill) {
        JSONArray a = o.optJSONArray(day);
        if (a == null || a.length() != 24) {
            a = new JSONArray();
            for (int h = 0; h < 24; h++) a.put(fill);
            put(o, day, a);
        }
        return a;
    }

    private static void put(JSONObject o, String key, Object value) {
        try { o.put(key, value); } catch (JSONException ignored) {}
    }

    /** ключи — даты ГГГГ-ММ-ДД, по порядку: так они сортируются и как строки */
    private static List<String> keys(JSONObject o) {
        List<String> out = new ArrayList<>();
        for (Iterator<String> it = o.keys(); it.hasNext();) out.add(it.next());
        Collections.sort(out);
        return out;
    }
}
