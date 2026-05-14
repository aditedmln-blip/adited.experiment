/* =====================================================
   APPS SCRIPT BACKEND — Monitoring Alat Berat
   Dinas PUPRPKP Kabupaten Malinau
   
   CARA DEPLOY:
   1. Buka Google Sheets → Extensions → Apps Script
   2. Paste seluruh kode ini, hapus kode lama
   3. Deploy → New deployment → Web app
   4. Execute as: Me | Who has access: Anyone
   5. Copy URL deployment → paste ke CONFIG di app.js
   ===================================================== */

const SPREADSHEET_ID = 'GANTI_DENGAN_ID_SPREADSHEET_ANDA';
const SHEET_DATA     = 'DATA_HARIAN';
const SHEET_ALAT     = 'DAFTAR_ALAT';
const DRIVE_FOLDER   = 'FotoAlatBerat'; /* nama folder di Google Drive */

/* =====================================================
   doPost — TERIMA DATA DARI PWA
   ===================================================== */
function doPost(e) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_DATA);
    const data  = JSON.parse(e.postData.contents);

    /* Validasi field wajib */
    if (!data.id_laporan || !data.tanggal || !data.nama_alat) {
      return jsonResponse('error', 'Field wajib tidak lengkap');
    }

    /* Cek duplikat berdasarkan id_laporan */
    const existing = sheet.getRange('A:A').getValues().flat();
    if (existing.includes(data.id_laporan)) {
      return jsonResponse('duplicate', 'Data sudah ada, skip');
    }

    /* Append satu baris baru */
    sheet.appendRow([
      data.id_laporan,           // A
      data.tanggal,              // B
      data.nama_operator || '-', // C
      data.nama_alat,            // D
      data.lokasi || '-',        // E
      data.koordinat || '-',     // F
      data.jam_mulai || '-',     // G
      data.jam_selesai || '-',   // H
      data.hm_awal || 0,         // I
      data.hm_akhir || 0,        // J
      data.hm_selisih || 0,      // K
      data.kegiatan || '-',      // L
      data.volume || '-',        // M
      data.bbm_liter || 0,       // N
      data.kondisi || '-',       // O
      data.kendala || '-',       // P
      data.foto_alat_url || '-', // Q
      data.foto_pkj_url || '-',  // R
      new Date()                 // S — waktu diterima server
    ]);

    /* Auto-format: tebalkan baris kondisi Rusak Berat */
    if (data.kondisi === 'Rusak Berat') {
      const lastRow = sheet.getLastRow();
      sheet.getRange(lastRow, 1, 1, 19).setBackground('#FFCDD2');
    }

    return jsonResponse('success', 'Data berhasil disimpan');

  } catch (err) {
    console.error('[doPost] Error:', err.message);
    return jsonResponse('error', err.message);
  }
}

/* =====================================================
   doGet — AMBIL DAFTAR ALAT & ACTIONS LAIN
   ===================================================== */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'get_alat';

  try {
    if (action === 'get_alat') {
      return getDaftarAlat();
    }
    if (action === 'ping') {
      return jsonResponse('ok', 'Server aktif - ' + new Date().toISOString());
    }
    if (action === 'rekap_harian') {
      return getRekapHarian(e.parameter.tanggal);
    }
    return jsonResponse('error', 'Action tidak dikenal: ' + action);

  } catch (err) {
    return jsonResponse('error', err.message);
  }
}

/* =====================================================
   AMBIL DAFTAR NAMA ALAT DARI SHEET DAFTAR_ALAT
   ===================================================== */
function getDaftarAlat() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_ALAT);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return ContentService.createTextOutput(
      JSON.stringify({ alat: [], message: 'Belum ada data alat' })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const list   = values.flat().filter(v => v && v.toString().trim() !== '');

  return ContentService.createTextOutput(
    JSON.stringify({ alat: list, total: list.length })
  ).setMimeType(ContentService.MimeType.JSON);
}

/* =====================================================
   REKAP HARIAN (dipanggil oleh trigger otomatis)
   ===================================================== */
function getRekapHarian(tglParam) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_DATA);
  const today = tglParam || Utilities.formatDate(new Date(), 'Asia/Makassar', 'yyyy-MM-dd');

  const data = sheet.getDataRange().getValues();
  const hasil = data.slice(1).filter(row => {
    const tglRow = Utilities.formatDate(new Date(row[1]), 'Asia/Makassar', 'yyyy-MM-dd');
    return tglRow === today;
  });

  return ContentService.createTextOutput(
    JSON.stringify({ tanggal: today, total: hasil.length, data: hasil })
  ).setMimeType(ContentService.MimeType.JSON);
}

/* =====================================================
   BUAT REKAP HARIAN OTOMATIS (jalankan via Trigger)
   Trigger: setiap hari pukul 17:00 WITA (10:00 UTC)
   ===================================================== */
function buatRekapOtomatis() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const data  = ss.getSheetByName(SHEET_DATA);
  const today = Utilities.formatDate(new Date(), 'Asia/Makassar', 'dd-MM-yyyy');
  const todayISO = Utilities.formatDate(new Date(), 'Asia/Makassar', 'yyyy-MM-dd');

  /* Hapus sheet rekap lama jika ada, buat baru */
  let rekapSheet = ss.getSheetByName('REKAP_' + today);
  if (rekapSheet) ss.deleteSheet(rekapSheet);
  rekapSheet = ss.insertSheet('REKAP_' + today);

  /* Header rekap */
  const headers = [
    'No','Tanggal','Operator','Nama Alat','Lokasi','Jam Mulai','Jam Selesai',
    'HM Awal','HM Akhir','HM Terpakai','BBM (L)','Kegiatan','Volume',
    'Kondisi','Kendala','Foto Alat','Foto Pekerjaan'
  ];
  rekapSheet.appendRow(headers);
  rekapSheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1565C0').setFontColor('#FFFFFF').setFontWeight('bold');

  /* Isi data hari ini */
  const allData = data.getDataRange().getValues();
  let no = 1;
  allData.slice(1).forEach(row => {
    if (!row[1]) return;
    const tglRow = Utilities.formatDate(new Date(row[1]), 'Asia/Makassar', 'yyyy-MM-dd');
    if (tglRow === todayISO) {
      rekapSheet.appendRow([no++, ...row.slice(1, 17)]);
    }
  });

  /* Auto-resize kolom */
  rekapSheet.autoResizeColumns(1, headers.length);

  Logger.log('Rekap ' + today + ' selesai. Total: ' + (no - 1) + ' laporan.');
  return no - 1;
}

/* =====================================================
   SETUP TRIGGER OTOMATIS (jalankan SEKALI saja)
   Setelah deploy: jalankan fungsi ini dari menu Run
   ===================================================== */
function setupTriggerHarian() {
  /* Hapus semua trigger lama */
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  /* Buat trigger baru: setiap hari pukul 17.00 WITA = 10.00 UTC */
  ScriptApp.newTrigger('buatRekapOtomatis')
    .timeBased()
    .atHour(10)  /* 10 UTC = 17 WITA */
    .everyDays(1)
    .create();

  Logger.log('Trigger harian berhasil dibuat! Rekap akan dibuat tiap pukul 17.00 WITA.');
}

/* =====================================================
   INISIALISASI SHEET (jalankan SEKALI untuk setup awal)
   ===================================================== */
function setupAwal() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  /* Buat / siapkan sheet DATA_HARIAN */
  let dataSheet = ss.getSheetByName(SHEET_DATA);
  if (!dataSheet) dataSheet = ss.insertSheet(SHEET_DATA);

  const headerData = [
    'ID_LAPORAN','TANGGAL','NAMA_OPERATOR','NAMA_ALAT','LOKASI',
    'KOORDINAT_GPS','JAM_MULAI','JAM_SELESAI','HM_AWAL','HM_AKHIR',
    'HM_SELISIH','KEGIATAN','VOLUME','BBM_LITER','KONDISI_ALAT',
    'KENDALA','FOTO_ALAT_URL','FOTO_PKJ_URL','WAKTU_SERVER'
  ];
  dataSheet.getRange(1, 1, 1, headerData.length).setValues([headerData]);
  dataSheet.getRange(1, 1, 1, headerData.length)
    .setBackground('#0D47A1').setFontColor('#FFFFFF').setFontWeight('bold');
  dataSheet.setFrozenRows(1);

  /* Buat / siapkan sheet DAFTAR_ALAT */
  let alatSheet = ss.getSheetByName(SHEET_ALAT);
  if (!alatSheet) alatSheet = ss.insertSheet(SHEET_ALAT);

  const headerAlat = [['NAMA_ALAT'],['Excavator Komatsu PC200'],['Bulldozer D6T'],
    ['Motor Grader 140K'],['Vibro Roller CS533E'],['Dump Truck Hino 500']];
  if (alatSheet.getLastRow() === 0) {
    alatSheet.getRange(1, 1, headerAlat.length, 1).setValues(headerAlat);
    alatSheet.getRange(1, 1, 1, 1)
      .setBackground('#0D47A1').setFontColor('#FFFFFF').setFontWeight('bold');
  }

  Logger.log('Setup awal selesai! Sheets sudah siap digunakan.');
}

/* =====================================================
   HELPER
   ===================================================== */
function jsonResponse(status, message) {
  return ContentService.createTextOutput(
    JSON.stringify({ status: status, message: message })
  ).setMimeType(ContentService.MimeType.JSON);
}
