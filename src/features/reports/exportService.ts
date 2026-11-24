import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';

let cachedUrduFontBase64: string | null = null;

/**
 * Loads the bundled Noto Naskh Arabic TTF font completely offline from app assets
 * and encodes it as base64 for embedding into PDF HTML.
 */
export async function loadOfflineUrduFontBase64(): Promise<string> {
  if (cachedUrduFontBase64 !== null) {
    return cachedUrduFontBase64;
  }
  try {
    const fontModule = require('@expo-google-fonts/noto-naskh-arabic/400Regular/NotoNaskhArabic_400Regular.ttf');
    const asset = Asset.fromModule(fontModule);
    if (!asset.localUri) {
      await asset.downloadAsync();
    }
    if (asset.localUri && asset.localUri.startsWith('file://')) {
      const file = new File(asset.localUri);
      cachedUrduFontBase64 = await file.base64();
      return cachedUrduFontBase64;
    }
  } catch {
    // Fallback cleanly to system Noto Naskh Arabic / sans-serif font
  }
  cachedUrduFontBase64 = '';
  return '';
}

async function createNamedPdfInCache(
  html: string,
  fileName: string,
): Promise<{ uri: string; safeName: string }> {
  const { uri } = await Print.printToFileAsync({
    html,
    width: 595,
    height: 842,
  });
  const safeName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;

  try {
    const targetFile = new File(Paths.cache, safeName);
    if (targetFile.exists) {
      targetFile.delete();
    }
    const sourceFile = new File(uri);
    await sourceFile.copy(targetFile);
    return { uri: targetFile.uri, safeName };
  } catch {
    return { uri, safeName };
  }
}

/**
 * Generates a PDF file and opens the native Share Sheet (WhatsApp, Gmail, Drive).
 * Falls back to native Print / Save-as-PDF preview if Android WebView's background
 * PDF writer fails on a specific device.
 */
export async function generateAndSharePdf(html: string, fileName: string): Promise<string> {
  try {
    const { uri, safeName } = await createNamedPdfInCache(html, fileName);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: safeName,
        UTI: 'com.adobe.pdf',
      });
      return uri;
    }
  } catch {
    // Some Android 14/15/16 WebView builds reject printToFileAsync before onLayout finishes;
    // fall back to Android's native PrintManager which always renders & saves PDF reliably.
  }

  await Print.printAsync({ html });
  return fileName;
}

/**
 * Opens Android's native Print Preview / "Save as PDF" dialog (1-tap save straight to
 * phone Downloads with live visual preview), or iOS Share Sheet ("Save to Files").
 * Works 100% offline on every Android & iOS version.
 */
export async function downloadPdfToDevice(
  html: string,
  fileName: string,
): Promise<{ saved: boolean; canceled?: boolean; fileName: string }> {
  const safeName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;

  if (Platform.OS === 'android') {
    await Print.printAsync({ html });
    return { saved: false, fileName: safeName };
  }

  const { uri } = await createNamedPdfInCache(html, safeName);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: safeName,
      UTI: 'com.adobe.pdf',
    });
    return { saved: true, fileName: safeName };
  }

  await Print.printAsync({ html });
  return { saved: false, fileName: safeName };
}

/** Writes UTF-8 CSV to cache and opens the native share sheet. */
export async function exportAndShareCsv(csvContent: string, fileName: string): Promise<string> {
  const safeName = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  const file = new File(Paths.cache, safeName);
  if (file.exists) {
    file.delete();
  }
  await file.write(csvContent);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      dialogTitle: safeName,
    });
  }
  return file.uri;
}
