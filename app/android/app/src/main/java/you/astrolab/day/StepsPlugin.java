package you.astrolab.day;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.os.Build;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

/**
 * Мост к учёту шагов для страницы (window.Capacitor.Plugins.Steps).
 *
 * Свой счётчик — датчик телефона, читается, пока приложение открыто:
 *   status()  → { sensor, permission }                         — без обращения к датчику
 *   request() → как today(), но сначала спрашивает разрешение
 *   today()   → { sensor, permission, steps, day, readAt, since, hours, est, history }
 *
 * Health Connect — шаги по часам, как в Samsung Health (StepsHealth.kt):
 *   health()        → { status, granted, hours?, history? }
 *   connectHealth() → спрашивает разрешение и отвечает как health()
 *   openHealthSettings() — настройки Health Connect, если система больше не спрашивает
 *
 * hours — дата → 24 числа шагов по часам, est — дата → 24 флага «час
 * посчитан оценкой» (только у своего счётчика), history — дата → шаги за день.
 * permission: granted | denied | prompt. С Android 10 счётчику шагов нужно
 * разрешение «Физическая активность»; раньше его не было, и там считаем
 * разрешение выданным. status: available | update | unavailable.
 */
@CapacitorPlugin(
    name = "Steps",
    permissions = { @Permission(alias = StepsPlugin.ALIAS, strings = { Manifest.permission.ACTIVITY_RECOGNITION }) }
)
public class StepsPlugin extends Plugin {
    static final String ALIAS = "activity";
    /** сколько дней сумм брать из Health Connect: глубже 30 дней до первого разрешения он не отдаёт */
    private static final int HEALTH_DAYS = 30;

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (permitted()) { today(call); return; }
        requestPermissionForAlias(ALIAS, call, "afterPermission");
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        today(call);
    }

    @PluginMethod
    public void today(PluginCall call) {
        if (!permitted()) { call.resolve(statusObject()); return; }
        // датчик читается с ожиданием — не в потоке моста
        new Thread(() -> {
            JSObject o = statusObject();
            try {
                StepStore.Result r = StepStore.update(getContext());
                o.put("sensor", r.sensor);
                o.put("steps", r.steps);
                o.put("day", r.day);
                o.put("readAt", r.readAt);
                o.put("since", r.since);
                o.put("hours", r.hours);
                o.put("est", r.est);
                o.put("history", r.history);
            } catch (RuntimeException e) {
                call.reject("Не удалось прочитать датчик шагов: " + e.getMessage());
                return;
            }
            call.resolve(o);
        }, "steps-today").start();
    }

    // ===== HEALTH CONNECT =====

    @PluginMethod
    public void health(PluginCall call) {
        JSObject o = new JSObject();
        String st = StepsHealth.status(getContext());
        o.put("status", st);
        if (!"available".equals(st)) { o.put("granted", false); call.resolve(o); return; }
        StepsHealth.read(getContext(), HEALTH_DAYS).whenComplete((JSONObject data, Throwable err) -> {
            if (err != null) { call.reject("Health Connect: " + err.getMessage()); return; }
            o.put("granted", data != null);
            if (data != null) { o.put("hours", data.opt("hours")); o.put("history", data.opt("history")); }
            call.resolve(o);
        });
    }

    @PluginMethod
    public void connectHealth(PluginCall call) {
        if (!"available".equals(StepsHealth.status(getContext()))) { health(call); return; }
        try {
            startActivityForResult(call, StepsHealth.permissionIntent(getContext()), "afterHealth");
        } catch (ActivityNotFoundException e) {
            call.reject("Health Connect не открылся: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void afterHealth(PluginCall call, ActivityResult result) {
        // что именно выдано, health() перепроверит сам
        health(call);
    }

    @PluginMethod
    public void openHealthSettings(PluginCall call) {
        try {
            getActivity().startActivity(StepsHealth.settingsIntent());
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Настройки Health Connect не открылись");
        }
    }

    private boolean permitted() {
        return Build.VERSION.SDK_INT < 29 || getPermissionState(ALIAS) == PermissionState.GRANTED;
    }

    private JSObject statusObject() {
        JSObject o = new JSObject();
        o.put("sensor", StepStore.hasSensor(getContext()));
        o.put("permission", Build.VERSION.SDK_INT < 29 ? "granted" : getPermissionState(ALIAS).toString());
        return o;
    }
}
