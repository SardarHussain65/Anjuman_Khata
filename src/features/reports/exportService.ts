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
    if (asset.localUri) {
      const file = new File(asset.localUri);
      cachedUrduFontBase64 = await file.base64();
      return cachedUrduFontBase64;
    }
  } catch {
    // Fallback cleanly if asset cannot be read in Jest/web
  }
  return '';
}

/**
 * Renders HTML into a named PDF file in cache and opens the native share sheet.
 * Works 100% offline using expo-print + expo-file-system + expo-sharing.
 */
export async function generateAndSharePdf(html: string, fileName: string): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html });
  const safeName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  const targetFile = new File(Paths.cache, safeName);
  if (targetFile.exists) {
    targetFile.delete();
  }
  const sourceFile = new File(uri);
  sourceFile.move(targetFile);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(targetFile.uri, {
      mimeType: 'application/pdf',
      dialogTitle: safeName,
      UTI: 'com.adobe.pdf',
    });
  }
  return targetFile.uri;
}

/** Writes UTF-8 CSV to cache and opens the native share sheet. */
export async function exportAndShareCsv(csvContent: string, fileName: string): Promise<string> {
  const safeName = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  const file = new File(Paths.cache, safeName);
  if (file.exists) {
    file.delete();
  }
  file.write(csvContent);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      dialogTitle: safeName,
    });
  }
  return file.uri;
}
