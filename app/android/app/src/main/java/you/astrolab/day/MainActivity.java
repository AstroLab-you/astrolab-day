package you.astrolab.day;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // свои плагины регистрируются до того, как мост поднимет WebView
        registerPlugin(StepsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
