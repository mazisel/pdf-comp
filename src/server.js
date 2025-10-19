import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import { tmpName } from 'tmp-promise'
import { createClient } from '@supabase/supabase-js'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const execFileAsync = promisify(execFile)

const requiredEnv = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_STORAGE_BUCKET']
const missingEnv = requiredEnv.filter((key) => !process.env[key])

if (missingEnv.length) {
  console.error(`Eksik ortam değişkenleri: ${missingEnv.join(', ')}`)
  process.exit(1)
}

const config = {
  port: Number.parseInt(process.env.PORT || '4000', 10),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY,
  bucket: process.env.SUPABASE_STORAGE_BUCKET,
  maxOutputMb: Number.parseInt(process.env.MAX_OUTPUT_MB || '95', 10),
  maxInputMb: Number.parseInt(process.env.MAX_INPUT_MB || '600', 10),
  ghostscriptPreset: process.env.GHOSTSCRIPT_PRESET || '/printer',
  tmpDir: process.env.TMP_DIR || path.join(os.tmpdir(), 'pdf-compressor')
}

await fs.mkdir(config.tmpDir, { recursive: true })

const supabase = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const storage = multer.diskStorage({
  destination: config.tmpDir,
  filename: (_req, file, cb) => {
    const sanitized = file.originalname.replace(/[^\w.-]/g, '_')
    cb(null, `${Date.now()}-${sanitized}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: config.maxInputMb * 1024 * 1024 }
})

const app = express()
app.disable('x-powered-by')
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

const compressPdf = async (sourcePath, outputPath, preset) => {
  const args = [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.5',
    `-dPDFSETTINGS=${preset}`,
    '-dNOPAUSE',
    '-dQUIET',
    '-dBATCH',
    `-sOutputFile=${outputPath}`,
    sourcePath
  ]

  await execFileAsync('gs', args)
}

const resolveStoragePath = ({ originalName, userId }) => {
  const safeName = originalName.replace(/[^\w.-]/g, '_')
  const owner = userId?.toString().trim() || 'anonymous'
  return `${owner}/${Date.now()}-${safeName}`
}

app.post('/compress-upload', upload.single('file'), async (req, res) => {
  let compressedPath
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Dosya bulunamadı' })
    }

    compressedPath = await tmpName({ tmpdir: config.tmpDir, postfix: '.pdf' })
    await compressPdf(req.file.path, compressedPath, config.ghostscriptPreset)

    const compressedBuffer = await fs.readFile(compressedPath)
    const compressedSizeMb = compressedBuffer.length / (1024 * 1024)

    if (compressedSizeMb > config.maxOutputMb) {
      return res.status(413).json({
        error: `Sıkıştırma sonrasında dosya ${config.maxOutputMb} MB sınırını aşıyor`,
        compressedSizeMb: Number(compressedSizeMb.toFixed(2))
      })
    }

    const storagePath = req.body.storagePath || resolveStoragePath({
      originalName: req.file.originalname,
      userId: req.body.userId
    })

    const { error: uploadError } = await supabase.storage
      .from(config.bucket)
      .upload(storagePath, compressedBuffer, {
        contentType: 'application/pdf',
        upsert: false,
        cacheControl: '3600'
      })

    if (uploadError) {
      throw uploadError
    }

    const {
      data: { publicUrl }
    } = supabase.storage.from(config.bucket).getPublicUrl(storagePath)

    res.json({
      message: 'Sıkıştırma tamamlandı ve Supabase\'e yüklendi',
      path: storagePath,
      url: publicUrl,
      originalSizeMb: Number((req.file.size / (1024 * 1024)).toFixed(2)),
      compressedSizeMb: Number(compressedSizeMb.toFixed(2))
    })
  } catch (error) {
    console.error('PDF sıkıştırma hatası:', error)
    res.status(500).json({ error: error.message })
  } finally {
    const pathsToClean = [req.file?.path, compressedPath].filter(Boolean)
    await Promise.all(pathsToClean.map(async (filePath) => {
      try {
        await fs.rm(filePath, { force: true })
      } catch (cleanupError) {
        console.warn(`Temp dosya silinemedi (${filePath}):`, cleanupError.message)
      }
    }))
  }
})

app.use((err, _req, res, _next) => {
  console.error('Beklenmeyen sunucu hatası:', err)
  res.status(500).json({ error: 'Sunucu hatası' })
})

app.listen(config.port, () => {
  console.log(`PDF compressor service listening on port ${config.port}`)
})
