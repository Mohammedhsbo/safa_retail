import type { CapacitorConfig } from '@capacitor/cli'

const allowLocalHttp = process.env.CAPACITOR_ALLOW_LOCAL_HTTP === 'true'

const config: CapacitorConfig = {
  appId: 'com.safa.retail',
  appName: 'SAFA Retail',
  webDir: 'dist',
  loggingBehavior: 'none',
  backgroundColor: '#00000000',
  android: {
    backgroundColor: '#00000000',
    allowMixedContent: allowLocalHttp,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: 'https',
    cleartext: allowLocalHttp,
  },
  plugins: {
    App: {
      disableBackButtonHandler: true,
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      backgroundColor: '#f7f8f6',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',
      backgroundColor: '#f7f8f6',
    },
  },
}

export default config
