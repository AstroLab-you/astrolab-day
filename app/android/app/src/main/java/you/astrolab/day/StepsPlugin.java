package you.astrolab.day;

import android.Manifest;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Мост к учёту шагов для страницы (window.Capacitor.Plugins.Steps).
 *
 *   status()  → { sensor, permission }                         — без обращения к датчику
 *   request() → как today(), но сначала спрашивает разрешение
 *   today()   → { sensor, permission, steps, day, readAt, history }
 *
 * permission: granted | denied | prompt. С Android 10 чтение счётчика шагов
 * требует разрешения «Физическая активность»; раньше его не было, и там
 * считаем разрешение выданным.
 */
@CapacitorPlugin(
    name = "Steps",
    permissions = { @Permission(alias = StepsPlugin.ALIAS, strings = { Manifest.permission.ACTIVITY_RECOGNITION }) }
)
public class StepsPlugin extends Plugin {
    static final String ALIAS = "activity";

    @Override
    public void load() {
        // каждый запуск заново ставит полуночный будильник: после обновления
        // приложения или очистки памяти он мог пропасть
        StepsReceiver.schedule(getContext());
    }

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
                o.put("history", r.history);
            } catch (RuntimeException e) {
                call.reject("Не удалось прочитать датчик шагов: " + e.getMessage());
                return;
            }
            call.resolve(o);
        }, "steps-today").start();
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
