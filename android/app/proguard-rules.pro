# R8 keep rules. Capacitor instantiates annotated plugin classes by reflection,
# and the WebView bridge calls @PluginMethod / @JavascriptInterface members by name.

-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable

# Capacitor plugins (annotated) and their PluginMethod entry points.
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# This app's native layer: plugin, media service and stream proxy.
-keep class com.bytune.music.** { *; }

# Cordova compatibility layer used by Capacitor.
-keep class org.apache.cordova.** { *; }
-keep public class * extends org.apache.cordova.CordovaPlugin

# Capacitor core reads these at runtime.
-keep class com.getcapacitor.** { *; }
-dontwarn com.getcapacitor.**
