package you.astrolab.day;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Будильник сразу после полуночи и перезагрузка телефона.
 *
 * В полночь читаем датчик, чтобы закрыть день точным показанием, а не
 * делить шаги между днями по времени. Будильник неточный (setAndAllowWhileIdle):
 * точный требует отдельного разрешения, а опоздание на несколько минут
 * здесь ничего не портит. После перезагрузки будильники пропадают — ставим
 * заново по BOOT_COMPLETED и заодно читаем датчик: он после загрузки с нуля,
 * и чем раньше это запомнить, тем меньше шагов потеряется.
 */
public class StepsReceiver extends BroadcastReceiver {
    static final String ACTION_TICK = "you.astrolab.day.STEPS_TICK";

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context ctx = context.getApplicationContext();
        final PendingResult result = goAsync();   // чтение датчика — до нескольких секунд, не в главном потоке
        new Thread(() -> {
            try { StepStore.update(ctx); }
            catch (RuntimeException ignored) { /* датчик занят или недоступен — дочитаем при открытии */ }
            finally { schedule(ctx); result.finish(); }
        }, "steps-tick").start();
    }

    /** Ставит будильник на минуту после ближайшей полуночи; повторный вызов заменяет прежний. */
    static void schedule(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent i = new Intent(ctx, StepsReceiver.class).setAction(ACTION_TICK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 1, i, flags);
        long at = StepStore.nextMidnight(System.currentTimeMillis()) + 60_000;
        if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        else am.set(AlarmManager.RTC_WAKEUP, at, pi);
    }
}
