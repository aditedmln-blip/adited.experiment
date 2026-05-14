/* =====================================================
   APP.JS — Monitoring Alat Berat
   Dinas PUPRPKP Kabupaten Malinau
   Logika: GPS, Kamera, Offline Queue, Sync ke Sheets
   ===================================================== */

/* ---- KONFIGURASI — WAJIB DIISI ---- */
const CONFIG = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzyKgNyI0HD3B4ub9JhklXGE_REK3JvfsPtqX8GbqMeh1kIpg2EGYhijtgaRISU5jZL/exec',
  CLOUDINARY_CLOUD: 'GANTI_DENGAN_CLOUD_NAME_CLOUDINARY',
  CLOUDINARY_PRESET: 'GANTI_DENGAN_UNSIGNED_PRESET',
  NAMA_DINAS: 'Dinas PUPRPERKIM Kabupaten Malinau',
  SYNC_INTERVAL_MS: 30000,   /* cek antrian setiap 30 detik */
  MAX_FOTO_PX: 1024,          /* resize foto max 1024px */
  FOTO_QUALITY: 0.75          /* kualitas JPEG 75% */
};

/* ---- STATE GLOBAL ---- */
let gpsLat = '', gpsLng = '';
let fotoAlatBase64 = '';
let fotoPekerjaanBase64 = '';
let syncTimer = null;

/* =====================================================
   INISIALISASI SAAT HALAMAN DIMUAT
   ===================================================== */
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  muatNamaOperator();
  isiTanggalOtomatis();
  muatDaftarAlat();
  setupKamera();
  setupGPS();
  setupFormSubmit();
  setupOnlineOfflineListener();
  updateStatusBar();
  startSyncTimer();
  tampilkanJumlahAntrian();
});

/* =====================================================
   SERVICE WORKER
   ===================================================== */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[SW] Terdaftar:', reg.scope))
      .catch(err => console.error('[SW] Gagal:', err));
  }
}

/* =====================================================
   PROFIL OPERATOR (disimpan di localStorage)
   ===================================================== */
function muatNamaOperator() {
  const nama = localStorage.getItem('nama_operator');
  if (!nama) {
    const input = prompt('Masukkan nama lengkap Anda (akan tersimpan otomatis):');
    if (input && input.trim()) {
      localStorage.setItem('nama_operator', input.trim());
      document.getElementById('namaOperator').textContent = input.trim();
    }
  } else {
    document.getElementById('namaOperator').textContent = nama;
  }
}

/* =====================================================
   TANGGAL OTOMATIS
   ===================================================== */
function isiTanggalOtomatis() {
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = today.getFullYear();
  const formatted = `${dd}/${mm}/${yyyy}`;
  document.getElementById('tanggalDisplay').textContent = formatted;
  document.getElementById('tanggalValue').value = `${yyyy}-${mm}-${dd}`;
}

/* =====================================================
   DAFTAR ALAT — AMBIL DARI SHEETS VIA APPS SCRIPT
   ===================================================== */
async function muatDaftarAlat() {
  const selectAlat = document.getElementById('namaAlat');
  const cached = localStorage.getItem('daftar_alat_cache');

  /* Isi dulu dari cache agar tidak kosong saat offline */
  if (cached) {
    const list = JSON.parse(cached);
    populateSelectAlat(selectAlat, list);
  }

  /* Coba ambil data terbaru dari server */
  try {
    const resp = await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=get_alat`, { signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const data = await resp.json();
      if (data.alat && data.alat.length > 0) {
        localStorage.setItem('daftar_alat_cache', JSON.stringify(data.alat));
        populateSelectAlat(selectAlat, data.alat);
      }
    }
  } catch (err) {
    console.log('[Alat] Menggunakan cache (offline):', err.message);
  }
}

function populateSelectAlat(el, list) {
  el.innerHTML = '<option value="">-- Pilih Alat --</option>';
  list.forEach(nama => {
    const opt = document.createElement('option');
    opt.value = nama;
    opt.textContent = nama;
    el.appendChild(opt);
  });
}

/* =====================================================
   GPS
   ===================================================== */
function setupGPS() {
  document.getElementById('btnGPS').addEventListener('click', ambilGPS);
}

function ambilGPS() {
  const btn = document.getElementById('btnGPS');
  const display = document.getElementById('koordinatDisplay');

  if (!navigator.geolocation) {
    display.textContent = 'GPS tidak didukung browser ini';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Mengambil GPS...';
  display.textContent = 'Menunggu sinyal GPS...';

  navigator.geolocation.getCurrentPosition(
    pos => {
      gpsLat = pos.coords.latitude.toFixed(6);
      gpsLng = pos.coords.longitude.toFixed(6);
      const akurasi = Math.round(pos.coords.accuracy);
      display.textContent = `${gpsLat}, ${gpsLng} (±${akurasi}m)`;
      display.style.color = 'var(--color-text-success, #3B6D11)';
      btn.textContent = 'Perbarui GPS';
      btn.disabled = false;
    },
    err => {
      display.textContent = `GPS gagal: ${err.message}`;
      display.style.color = 'var(--color-text-danger, #A32D2D)';
      btn.textContent = 'Coba Lagi';
      btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

/* =====================================================
   KAMERA & FOTO
   ===================================================== */
function setupKamera() {
  document.getElementById('inputFotoAlat').addEventListener('change', e => {
    prosesGambar(e.target.files[0], 'fotoAlat', 'previewAlat', val => { fotoAlatBase64 = val; });
  });
  document.getElementById('inputFotoPekerjaan').addEventListener('change', e => {
    prosesGambar(e.target.files[0], 'fotoPekerjaan', 'previewPekerjaan', val => { fotoPekerjaanBase64 = val; });
  });
}

function prosesGambar(file, inputId, previewId, callback) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      /* Resize gambar agar tidak terlalu besar */
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      const max = CONFIG.MAX_FOTO_PX;
      if (w > max || h > max) {
        if (w > h) { h = Math.round(h * max / w); w = max; }
        else { w = Math.round(w * max / h); h = max; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/jpeg', CONFIG.FOTO_QUALITY);
      callback(compressed);

      /* Tampilkan preview */
      const preview = document.getElementById(previewId);
      preview.src = compressed;
      preview.style.display = 'block';
      const kb = Math.round(compressed.length * 0.75 / 1024);
      document.getElementById(previewId + 'Info').textContent = `${w}×${h}px · ~${kb}KB`;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* =====================================================
   SUBMIT FORM — SIMPAN KE ANTRIAN OFFLINE
   ===================================================== */
function setupFormSubmit() {
  document.getElementById('formLaporan').addEventListener('submit', async e => {
    e.preventDefault();
    simpanLaporan();
  });
}

function simpanLaporan() {
  /* Validasi field wajib */
  const namaAlat = document.getElementById('namaAlat').value;
  const lokasi = document.getElementById('lokasiPekerjaan').value.trim();
  const jamMulai = document.getElementById('jamMulai').value;
  const jamSelesai = document.getElementById('jamSelesai').value;
  const hmAwal = document.getElementById('hmAwal').value;
  const hmAkhir = document.getElementById('hmAkhir').value;
  const kegiatan = document.getElementById('kegiatan').value.trim();
  const bbm = document.getElementById('bbmLiter').value;
  const kondisi = document.getElementById('kondisiAlat').value;

  if (!namaAlat || !lokasi || !jamMulai || !jamSelesai || !hmAwal || !kegiatan || !kondisi) {
    tampilkanPesan('Harap isi semua field wajib (bertanda *)', 'error');
    return;
  }

  if (parseFloat(hmAkhir) < parseFloat(hmAwal)) {
    tampilkanPesan('HM Akhir tidak boleh lebih kecil dari HM Awal', 'error');
    return;
  }

  /* Buat ID unik laporan */
  const idLaporan = `LAP-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

  /* Susun objek data laporan */
  const laporan = {
    id_laporan: idLaporan,
    tanggal: document.getElementById('tanggalValue').value,
    nama_operator: localStorage.getItem('nama_operator') || '-',
    nama_alat: namaAlat,
    lokasi: lokasi,
    koordinat: (gpsLat && gpsLng) ? `${gpsLat},${gpsLng}` : 'Tidak diambil',
    jam_mulai: jamMulai,
    jam_selesai: jamSelesai,
    hm_awal: parseFloat(hmAwal),
    hm_akhir: parseFloat(hmAkhir || hmAwal),
    hm_selisih: parseFloat(hmAkhir || hmAwal) - parseFloat(hmAwal),
    kegiatan: kegiatan,
    volume: document.getElementById('volumePekerjaan').value || '-',
    bbm_liter: parseFloat(bbm) || 0,
    kondisi: kondisi,
    kendala: document.getElementById('kendala').value || '-',
    foto_alat: fotoAlatBase64,
    foto_pekerjaan: fotoPekerjaanBase64,
    waktu_simpan: new Date().toISOString(),
    status_sync: 'pending'
  };

  /* Simpan ke antrian di localStorage */
  const antrian = JSON.parse(localStorage.getItem('antrian_sync') || '[]');
  antrian.push(laporan);
  localStorage.setItem('antrian_sync', JSON.stringify(antrian));

  tampilkanPesan(`Laporan ${idLaporan} tersimpan! Akan dikirim saat internet tersedia.`, 'success');
  tampilkanJumlahAntrian();
  resetForm();

  /* Langsung coba sync jika online */
  if (navigator.onLine) {
    setTimeout(jalankanSync, 1500);
  }
}

/* =====================================================
   SYNC KE GOOGLE SHEETS VIA APPS SCRIPT
   ===================================================== */
async function jalankanSync() {
  const antrian = JSON.parse(localStorage.getItem('antrian_sync') || '[]');
  if (antrian.length === 0) return;

  const btnSync = document.getElementById('btnSync');
  if (btnSync) btnSync.disabled = true;

  let berhasil = 0;
  let gagal = 0;
  const sisaAntrian = [];

  for (const item of antrian) {
    try {
      /* Upload foto dulu ke Cloudinary jika ada */
      let urlFotoAlat = '';
      let urlFotoPkj = '';

      if (item.foto_alat && item.foto_alat.startsWith('data:')) {
        urlFotoAlat = await uploadFotoCloudinary(item.foto_alat, `alat_${item.id_laporan}`);
      }
      if (item.foto_pekerjaan && item.foto_pekerjaan.startsWith('data:')) {
        urlFotoPkj = await uploadFotoCloudinary(item.foto_pekerjaan, `pkj_${item.id_laporan}`);
      }

      /* Kirim data ke Apps Script (tanpa base64 foto) */
      const payload = { ...item };
      delete payload.foto_alat;
      delete payload.foto_pekerjaan;
      payload.foto_alat_url = urlFotoAlat || '(foto tidak diunggah)';
      payload.foto_pkj_url = urlFotoPkj || '(foto tidak diunggah)';

      const resp = await fetch(CONFIG.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });

      const hasil = await resp.json();

      if (hasil.status === 'success' || hasil.status === 'duplicate') {
        berhasil++;
        /* Hapus foto dari antrian untuk hemat storage setelah berhasil upload */
        item.foto_alat = '';
        item.foto_pekerjaan = '';
        item.status_sync = 'synced';
      } else {
        throw new Error(hasil.message || 'Respons tidak diketahui');
      }
    } catch (err) {
      console.warn('[Sync] Gagal untuk', item.id_laporan, ':', err.message);
      gagal++;
      sisaAntrian.push(item); /* Simpan kembali yang gagal */
    }
  }

  localStorage.setItem('antrian_sync', JSON.stringify(sisaAntrian));
  tampilkanJumlahAntrian();

  if (berhasil > 0) {
    tampilkanPesan(`${berhasil} laporan berhasil dikirim ke Sheets.`, 'success');
  }
  if (gagal > 0) {
    tampilkanPesan(`${gagal} laporan gagal dikirim, akan dicoba lagi.`, 'warning');
  }

  if (btnSync) btnSync.disabled = false;
}

/* =====================================================
   UPLOAD FOTO KE CLOUDINARY (GRATIS, TIDAK PERLU LOGIN)
   ===================================================== */
async function uploadFotoCloudinary(base64Data, publicId) {
  if (!CONFIG.CLOUDINARY_CLOUD || CONFIG.CLOUDINARY_CLOUD.includes('GANTI')) {
    console.log('[Foto] Cloudinary belum dikonfigurasi, skip upload foto');
    return '';
  }

  try {
    const formData = new FormData();
    formData.append('file', base64Data);
    formData.append('upload_preset', CONFIG.CLOUDINARY_PRESET);
    formData.append('public_id', publicId);
    formData.append('folder', 'monitoring_alat_berat');

    const resp = await fetch(
      `https://api.cloudinary.com/v1_1/${CONFIG.CLOUDINARY_CLOUD}/image/upload`,
      { method: 'POST', body: formData, signal: AbortSignal.timeout(30000) }
    );

    if (resp.ok) {
      const data = await resp.json();
      return data.secure_url;
    }
  } catch (err) {
    console.warn('[Foto] Upload gagal:', err.message);
  }
  return '';
}

/* =====================================================
   TIMER SYNC OTOMATIS
   ===================================================== */
function startSyncTimer() {
  syncTimer = setInterval(() => {
    if (navigator.onLine) jalankanSync();
  }, CONFIG.SYNC_INTERVAL_MS);
}

/* =====================================================
   ONLINE / OFFLINE LISTENER
   ===================================================== */
function setupOnlineOfflineListener() {
  window.addEventListener('online', () => {
    updateStatusBar();
    tampilkanPesan('Koneksi tersambung! Sinkronisasi dimulai...', 'success');
    setTimeout(jalankanSync, 2000);
  });
  window.addEventListener('offline', () => {
    updateStatusBar();
    tampilkanPesan('Koneksi terputus. Data akan tersimpan lokal.', 'warning');
  });
}

function updateStatusBar() {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (navigator.onLine) {
    dot.style.background = '#4CAF50';
    text.textContent = 'Online';
  } else {
    dot.style.background = '#F44336';
    text.textContent = 'Offline';
  }
}

/* =====================================================
   UI HELPERS
   ===================================================== */
function tampilkanJumlahAntrian() {
  const antrian = JSON.parse(localStorage.getItem('antrian_sync') || '[]');
  const el = document.getElementById('jumlahAntrian');
  if (el) {
    el.textContent = antrian.length > 0
      ? `${antrian.length} laporan menunggu sync`
      : 'Semua data sudah tersinkron';
    el.style.color = antrian.length > 0 ? '#E65100' : '#2E7D32';
  }
}

function tampilkanPesan(teks, tipe) {
  const el = document.getElementById('pesanStatus');
  if (!el) return;
  el.textContent = teks;
  el.className = 'pesan-status pesan-' + tipe;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function resetForm() {
  document.getElementById('formLaporan').reset();
  gpsLat = ''; gpsLng = '';
  fotoAlatBase64 = ''; fotoPekerjaanBase64 = '';
  ['previewAlat', 'previewPekerjaan'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.src = ''; }
  });
  ['previewAlatInfo', 'previewPekerjaanInfo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  document.getElementById('koordinatDisplay').textContent = 'Belum diambil';
  document.getElementById('koordinatDisplay').style.color = '';
  document.getElementById('btnGPS').textContent = 'Ambil GPS Sekarang';
  isiTanggalOtomatis();
}

/* =====================================================
   GANTI NAMA OPERATOR
   ===================================================== */
function gantiNamaOperator() {
  const input = prompt('Masukkan nama operator baru:', localStorage.getItem('nama_operator') || '');
  if (input && input.trim()) {
    localStorage.setItem('nama_operator', input.trim());
    document.getElementById('namaOperator').textContent = input.trim();
  }
}

/* Expose untuk HTML */
window.gantiNamaOperator = gantiNamaOperator;
window.jalankanSync = jalankanSync;
