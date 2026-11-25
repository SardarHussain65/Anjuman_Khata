const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('expo/config-plugins');

const PDF_DOWNLOADER_MODULE_KT = `package com.anjumankhata.app

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream

class PdfDownloaderModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "PdfDownloader"

  @ReactMethod
  fun savePdfToDownloads(base64Data: String, fileName: String, promise: Promise) {
    try {
      val bytes = Base64.decode(base64Data, Base64.DEFAULT)
      if (bytes.isEmpty()) {
        promise.reject("EMPTY_PDF", "Generated PDF data is empty.")
        return
      }

      val safeName = if (fileName.endsWith(".pdf", ignoreCase = true)) fileName else "$fileName.pdf"

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val resolver = reactContext.contentResolver
        val relativePath = Environment.DIRECTORY_DOWNLOADS + "/AnjumanKhata"
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, safeName)
          put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
          put(MediaStore.Downloads.RELATIVE_PATH, relativePath)
          put(MediaStore.Downloads.IS_PENDING, 1)
        }

        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
          ?: throw IllegalStateException("MediaStore failed to create download entry.")

        try {
          resolver.openOutputStream(uri, "w")?.use { out ->
            out.write(bytes)
            out.flush()
          } ?: throw IllegalStateException("Could not open output stream for $uri")

          val readyValues = ContentValues().apply {
            put(MediaStore.Downloads.IS_PENDING, 0)
          }
          resolver.update(uri, readyValues, null, null)
        } catch (writeErr: Exception) {
          resolver.delete(uri, null, null)
          throw writeErr
        }

        val result = Arguments.createMap().apply {
          putString("uri", uri.toString())
          putString("displayPath", "Downloads/AnjumanKhata/$safeName")
        }
        promise.resolve(result)
      } else {
        @Suppress("DEPRECATION")
        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val appDir = File(downloadsDir, "AnjumanKhata")
        if (!appDir.exists()) appDir.mkdirs()
        val outFile = File(appDir, safeName)
        FileOutputStream(outFile).use { out ->
          out.write(bytes)
          out.flush()
        }
        val result = Arguments.createMap().apply {
          putString("uri", Uri.fromFile(outFile).toString())
          putString("displayPath", "Downloads/AnjumanKhata/$safeName")
        }
        promise.resolve(result)
      }
    } catch (e: Exception) {
      promise.reject("PDF_SAVE_ERROR", e.message ?: "Failed to save PDF to Downloads.", e)
    }
  }

  @ReactMethod
  fun openPdfUri(uriString: String, title: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      val viewIntent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/pdf")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(viewIntent, title).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(chooser)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("PDF_OPEN_ERROR", e.message ?: "No PDF viewer app found.", e)
    }
  }

  @ReactMethod
  fun sharePdfUri(uriString: String, title: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      val shareIntent = Intent(Intent.ACTION_SEND).apply {
        type = "application/pdf"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, title)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(shareIntent, title).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(chooser)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("PDF_SHARE_ERROR", e.message ?: "Failed to share PDF.", e)
    }
  }
}
`;

const PDF_DOWNLOADER_PACKAGE_KT = `package com.anjumankhata.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class PdfDownloaderPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(PdfDownloaderModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;

function withNativePdfDownloader(config) {
  // 1. Add <queries> for PDF VIEW & SEND intents so Android 11+ can discover PDF viewers
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!manifest.queries) {
      manifest.queries = [{}];
    }
    const queries = manifest.queries[0];
    if (!queries.intent) {
      queries.intent = [];
    }

    const hasPdfView = queries.intent.some(
      (i) => i.action?.[0]?.$?.['android:name'] === 'android.intent.action.VIEW' &&
        i.data?.[0]?.$?.['android:mimeType'] === 'application/pdf',
    );
    if (!hasPdfView) {
      queries.intent.push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        data: [{ $: { 'android:mimeType': 'application/pdf' } }],
      });
    }

    const hasPdfSend = queries.intent.some(
      (i) => i.action?.[0]?.$?.['android:name'] === 'android.intent.action.SEND' &&
        i.data?.[0]?.$?.['android:mimeType'] === 'application/pdf',
    );
    if (!hasPdfSend) {
      queries.intent.push({
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
        data: [{ $: { 'android:mimeType': 'application/pdf' } }],
      });
    }

    return cfg;
  });

  // 2. Write Kotlin native module & package files
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const pkgDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/java/com/anjumankhata/app',
      );
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'PdfDownloaderModule.kt'), PDF_DOWNLOADER_MODULE_KT);
      fs.writeFileSync(path.join(pkgDir, 'PdfDownloaderPackage.kt'), PDF_DOWNLOADER_PACKAGE_KT);
      return cfg;
    },
  ]);

  // 3. Register PdfDownloaderPackage() in MainApplication.kt
  config = withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (!contents.includes('PdfDownloaderPackage()')) {
      contents = contents.replace(
        'PackageList(this).packages.apply {',
        'PackageList(this).packages.apply {\n          add(PdfDownloaderPackage())',
      );
      cfg.modResults.contents = contents;
    }
    return cfg;
  });

  return config;
}

module.exports = withNativePdfDownloader;
