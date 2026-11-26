package cn.tdharness.mobile

import android.app.Application
import android.net.ConnectivityManager
import android.net.Network

class TDHApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Site.load(this)
        if (BuildConfig.DEBUG) android.webkit.WebView.setWebContentsDebuggingEnabled(true)
        Session.init(this)
        ChatWatch.channels(this)
        // Another network (Wi-Fi in the office, 5G outside): the server is looked for again.
        runCatching {
            getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) = Net.forget()
                override fun onLost(network: Network) = Net.forget()
            })
        }
    }
}
