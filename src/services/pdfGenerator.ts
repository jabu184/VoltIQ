import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { CertificateData, buildCertificateHtml } from './certificateTemplate';

export { CertificateData, buildCertificateHtml };

/**
 * Generates and triggers the platform share dialog for the PDF certificate
 */
export async function generateAndShareCertificate(data: CertificateData): Promise<string> {
  const html = buildCertificateHtml(data);

  if (Platform.OS === 'web') {
    // For web, open print dialog or new tab
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
    return 'web-printed';
  }

  // Native Android/iOS: generate PDF file using expo-print
  const { uri } = await Print.printToFileAsync({
    html,
    base64: false,
  });

  // Share or open with system share dialog
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      UTI: '.pdf',
      mimeType: 'application/pdf',
      dialogTitle: `TrueBattery Certificate - ${data.vehicle.vin}`,
    });
  }

  return uri;
}
