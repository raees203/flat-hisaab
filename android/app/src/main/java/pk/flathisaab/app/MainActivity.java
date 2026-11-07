package pk.flathisaab.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Phones with a very large system font size squeeze the layout so words break
        // into one letter per line. Keep the user's font choice, but cap it at 115%.
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebSettings settings = getBridge().getWebView().getSettings();
            int zoom = settings.getTextZoom();
            if (zoom > 115) settings.setTextZoom(115);
            if (zoom < 90) settings.setTextZoom(90);
        }
    }
}
