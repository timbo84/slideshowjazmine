import { createClient } from '@supabase/supabase-js'
import Slideshow from '@/app/components/Slideshow'

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|avif|heic|heif)$/i

function extractDateMs(filename) {
  const m = filename.match(/(19\d{2}|20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/)
  if (!m) return Infinity // files without dates sort to the end
  return new Date(+m[1], +m[2] - 1, +m[3]).getTime()
}
const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|ogg|wav|flac)$/i

function makeSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) return null
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || key
  return createClient(url, serviceKey)
}

async function getImages(supabase) {
  const bucket = process.env.SUPABASE_BUCKET || 'photos'
  const folder = process.env.SUPABASE_FOLDER || ''

  const { data, error } = await supabase.storage
    .from(bucket)
    .list(folder || undefined, {
      limit: 1000,
      sortBy: { column: 'name', order: 'asc' },
    })

  if (error) {
    console.error('Supabase images error:', error.message)
    return { images: [], error: error.message }
  }

  const images = (data ?? [])
    .filter((f) => f.name !== '.emptyFolderPlaceholder' && IMAGE_EXTENSIONS.test(f.name))
    .sort((a, b) => {
      const aDsc = /^dsc/i.test(a.name)
      const bDsc = /^dsc/i.test(b.name)
      if (aDsc && !bDsc) return -1
      if (!aDsc && bDsc) return 1
      return extractDateMs(a.name) - extractDateMs(b.name)
    })
    .map((f) => {
      const path = folder ? `${folder}/${f.name}` : f.name
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path)
      return urlData.publicUrl
    })

  return { images, error: null }
}

async function getSongs(supabase) {
  const bucket = process.env.SUPABASE_BUCKET || 'photos'
  const folder = process.env.SUPABASE_MUSIC_FOLDER || 'music'

  const { data, error } = await supabase.storage
    .from(bucket)
    .list(folder, { limit: 200 })

  if (error || !data) return []

  return (data ?? [])
    .filter((f) => f.name !== '.emptyFolderPlaceholder' && AUDIO_EXTENSIONS.test(f.name))
    .map((f) => {
      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(`${folder}/${f.name}`)
      return urlData.publicUrl
    })
}

export default async function Home() {
  const supabase = makeSupabase()
  if (!supabase) {
    return <Slideshow images={[]} songs={[]} configError="missing_config" />
  }

  const [{ images, error }, songs] = await Promise.all([
    getImages(supabase),
    getSongs(supabase),
  ])

  return <Slideshow images={images} songs={songs} configError={error} />
}
