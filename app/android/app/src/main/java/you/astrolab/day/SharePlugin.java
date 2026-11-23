package you.astrolab.day;

import android.content.Intent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * «Поделиться приложением» (window.Capacitor.Plugins.Share).
 *
 *   share({ text, title? }) — системное окно «Поделиться»: мессенджеры,
 *   почта, «Копировать». Отвечает сразу, как окно открылось: что человек
 *   выбрал и отправил ли, Android не сообщает.
 *
 * В WebView нет navigator.share, а ради одного Intent тянуть пакет
 * @capacitor/share не стоит — поэтому свой плагин на десяток строк.
 */
@CapacitorPlugin(name = "Share")
public class SharePlugin extends Plugin {
    @PluginMethod
    public void share(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) { call.reject("нет текста"); return; }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        Intent chooser = Intent.createChooser(send, call.getString("title", "Поделиться"));
        try {
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("не открылось окно «Поделиться»", e);
        }
    }
}
