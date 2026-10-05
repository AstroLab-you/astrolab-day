package you.astrolab.day;

import android.app.Activity;
import android.os.Bundle;
import android.text.method.LinkMovementMethod;
import android.text.util.Linkify;
import android.util.TypedValue;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * Зачем приложению шаги — экран, который Health Connect показывает из
 * своих настроек и при запросе разрешения. Без него Android 14+ не выдаёт
 * разрешение на чтение вовсе, поэтому он обязателен, даже простой.
 */
public class HealthRationaleActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle("Astrolab и шаги");
        TextView t = new TextView(this);
        int pad = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 20, getResources().getDisplayMetrics());
        t.setPadding(pad, pad, pad, pad);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        t.setLineSpacing(0, 1.25f);
        t.setText("Astrolab читает из Health Connect только число шагов — чтобы показать, "
            + "сколько и в какие часы вы прошли за день, и для игры «полёт к планетам».\n\n"
            + "Шаги остаются в телефоне: на сервер они не уходят и в статистику не попадают. "
            + "Записывать что-либо в Health Connect приложение не умеет.\n\n"
            + "Отозвать доступ можно в любой момент в настройках Health Connect.\n\n"
            + "Политика конфиденциальности: https://astrolab.you/privacy.html");
        Linkify.addLinks(t, Linkify.WEB_URLS);
        t.setMovementMethod(LinkMovementMethod.getInstance());
        ScrollView s = new ScrollView(this);
        s.addView(t);
        setContentView(s);
    }
}
