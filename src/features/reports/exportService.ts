import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

let cachedUrduFontBase64: string | null = null;

/**
 * Loads the bundled Noto Naskh Arabic TTF font completely offline from app assets
 * and encodes it as base64 for embedding into HTML exports.
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
    // Fallback cleanly to system font
  }
  cachedUrduFontBase64 = '';
  return '';
}

function normalizePdfName(fileName: string): string {
  const clean = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return clean.endsWith('.pdf') ? clean : `${clean}.pdf`;
}

/**
 * Writes pure-JS generated PDF bytes to the app's cache directory.
 * Zero WebView / expo-print dependency — works 100% offline on every Android & iOS version.
 */
export async function writePdfBytesToCache(
  pdfBytes: Uint8Array,
  fileName: string,
): Promise<{ file: File; safeName: string }> {
  const safeName = normalizePdfName(fileName);
  const file = new File(Paths.cache, safeName);
  if (file.exists) {
    file.delete();
  }
  await file.write(pdfBytes);
  return { file, safeName };
}

/**
 * Generates a real PDF file in cache and opens the native Share Sheet (WhatsApp, Gmail, Drive, PDF viewer).
 */
export async function sharePdfBytes(pdfBytes: Uint8Array, fileName: string): Promise<string> {
  const { file, safeName } = await writePdfBytesToCache(pdfBytes, fileName);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/pdf',
      dialogTitle: safeName,
      UTI: 'com.adobe.pdf',
    });
    return file.uri;
  }

  if (await file.canPreview({ mimeType: 'application/pdf' })) {
    await file.preview({ mimeType: 'application/pdf', title: safeName });
  }
  return file.uri;
}

/**
 * Opens a generated PDF directly in the device's native PDF viewer (`ACTION_VIEW` / Quick Look),
 * falling back to the Share Sheet if no viewer is registered.
 */
export async function previewOrSharePdfFile(file: File, safeName: string): Promise<void> {
  try {
    if (await file.canPreview({ mimeType: 'application/pdf' })) {
      await file.preview({ mimeType: 'application/pdf', title: safeName });
      return;
    }
  } catch {
    // Fall through to Share Sheet
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/pdf',
      dialogTitle: safeName,
      UTI: 'com.adobe.pdf',
    });
  }
}

/**
 * Downloads/saves a real PDF directly onto the user's phone storage:
 * - Android: opens the native folder picker (e.g. Downloads), creates `<fileName>.pdf`,
 *   and writes the PDF binary bytes directly to that folder.
 * - iOS: opens the native Share Sheet ("Save to Files").
 */
export async function downloadPdfBytesToDevice(
  pdfBytes: Uint8Array,
  fileName: string,
): Promise<{ saved: boolean; canceled?: boolean; fileName: string; cacheFile: File }> {
  const { file: cacheFile, safeName } = await writePdfBytesToCache(pdfBytes, fileName);

  if (Platform.OS === 'android') {
    try {
      const pickedDir = await Directory.pickDirectoryAsync();
      const targetFile = pickedDir.createFile(safeName, 'application/pdf');
      await targetFile.write(pdfBytes);
      return { saved: true, fileName: safeName, cacheFile };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/cancel|dismiss|abort|user/i.test(msg)) {
        return { saved: false, canceled: true, fileName: safeName, cacheFile };
      }
      // Fallback: if SAF folder picker is unavailable on a specific OEM ROM, open Share Sheet
      await previewOrSharePdfFile(cacheFile, safeName);
      return { saved: false, fileName: safeName, cacheFile };
    }
  }

  await sharePdfBytes(pdfBytes, safeName);
  return { saved: true, fileName: safeName, cacheFile };
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
