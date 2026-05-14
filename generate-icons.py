"""
generate-icons.py
Buat ikon PWA untuk aplikasi monitoring alat berat.
Jalankan: pip install Pillow && python generate-icons.py
"""
try:
    from PIL import Image, ImageDraw, ImageFont
    import os

    def buat_ikon(ukuran, path_output):
        img = Image.new('RGB', (ukuran, ukuran), color='#1565C0')
        draw = ImageDraw.Draw(img)

        # Lingkaran dalam (background putih)
        margin = int(ukuran * 0.12)
        r = ukuran - margin * 2
        draw.ellipse([margin, margin, margin + r, margin + r], fill='#0D47A1')

        # Huruf "AB" (AlBerat) di tengah
        font_size = int(ukuran * 0.35)
        try:
            font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', font_size)
        except:
            font = ImageFont.load_default()

        teks = "AB"
        bbox = draw.textbbox((0, 0), teks, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        x = (ukuran - tw) // 2
        y = (ukuran - th) // 2 - int(ukuran * 0.02)
        draw.text((x, y), teks, fill='white', font=font)

        os.makedirs(os.path.dirname(path_output), exist_ok=True)
        img.save(path_output, 'PNG')
        print(f'Ikon {ukuran}x{ukuran} dibuat: {path_output}')

    buat_ikon(192, 'icons/icon-192.png')
    buat_ikon(512, 'icons/icon-512.png')
    print('Selesai! Ikon siap digunakan.')

except ImportError:
    print('Pillow belum terinstall.')
    print('Jalankan: pip install Pillow')
    print('Atau gunakan ikon PNG manual ukuran 192x192 dan 512x512.')
