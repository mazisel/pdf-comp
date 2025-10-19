# PDF Compressor Service

Supabase Storage’a yüklemeden önce PDF dosyalarını Ghostscript kullanarak sıkıştıran ve sonucu doğrudan Storage bucket’ına yazan küçük bir servis. Docker container olarak çalışır; istemciler dosyayı `POST /compress-upload` endpoint’ine gönderir.

## Gereksinimler

- Docker / Docker Compose
- Supabase instance (SaaS veya self-host)
- `service_role` anahtarı (sadece backend’de kullanılacak)
- Sunucuda Ghostscript (container içinde otomatik kuruluyor)

## Ortam Değişkenleri

`.env` dosyası oluşturup aşağıdaki değerleri girin:

```env
SUPABASE_URL=https://<proje>.supabase.co
SUPABASE_SERVICE_KEY=<service_role_key>
SUPABASE_STORAGE_BUCKET=pdfs
PORT=4000
MAX_INPUT_MB=600          # İsteğe bağlı: kabul edilen maksimum dosya boyutu
MAX_OUTPUT_MB=95          # Sıkıştırma sonrası hedeflenen üst sınır
GHOSTSCRIPT_PRESET=/printer  # /screen, /ebook, /prepress seçenekleri
TMP_DIR=/tmp/pdf-compressor   # Kalıcı disk klasörü (volume bağlamak önerilir)
```

## Docker ile Çalıştırma

```bash
cd services/pdf-compressor
docker build -t pdf-compressor .
docker run --rm \
  --env-file .env \
  -p 4000:4000 \
  -v $(pwd)/tmp:/tmp/pdf-compressor \
  pdf-compressor
```

Container ayağa kalktığında `http://localhost:4000/health` “ok” döner.

## Docker Compose Örneği

```yaml
services:
  pdf-compressor:
    build: .
    ports:
      - "4000:4000"
    env_file:
      - .env
    volumes:
      - ./tmp:/tmp/pdf-compressor
```

## API

- `POST /compress-upload`
  - Form-data field’ı `file` olmalı.
  - Opsiyonel `userId` veya `storagePath` alanları ile Supabase’de kayıt yolunu kontrol edebilirsiniz.
  - Başarılı yanıt örneği:
    ```json
    {
      "message": "Sıkıştırma tamamlandı ve Supabase'e yüklendi",
      "path": "user-id/1700000000000-dosya.pdf",
      "url": "https://.../storage/v1/object/public/pdfs/user-id/...",
      "originalSizeMb": 180.45,
      "compressedSizeMb": 82.31
    }
    ```
  - `413` dönerse sıkıştırma sonrası dosya hâlâ limitin üzerindedir.

## Frontend Entegrasyonu

React tarafında, dosyayı Supabase’a doğrudan yüklemek yerine bu servise gönder:

```js
const formData = new FormData()
formData.append('file', file)
formData.append('userId', user.id)

const response = await fetch('https://compressor.domain.com/compress-upload', {
  method: 'POST',
  body: formData,
  headers: {
    Authorization: `Bearer ${session.access_token}` // Sunucu doğrulaması yapıyorsa
  }
})
const result = await response.json()
```

Servis JSON yanıtında Supabase URL’sini verir; bu bilgiyi veritabanına kaydedebilir veya kullanıcıya gösterebilirsiniz.
