import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Play, Video as VideoIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/primitives';
import { EmptyState, QueryState } from '@/components/shared/states';
import { supabase, unwrap } from '@/lib/supabase';
import type { Video } from '@/types/db';

/** Extracts the 11-character YouTube id from the common URL shapes. */
export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export function useVideos(audience: 'public' | 'all') {
  return useQuery({
    queryKey: ['videos', audience],
    queryFn: async (): Promise<Video[]> => {
      if (!supabase) return [];
      let q = supabase.from('videos').select('*').eq('is_published', true).order('sort_order').order('created_at', { ascending: false });
      if (audience === 'public') q = q.eq('audience', 'public');
      return unwrap(await q) as Video[];
    },
  });
}

function VideoCard({ video, index }: { video: Video; index: number }) {
  const { t, i18n } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const ta = i18n.language === 'ta';
  const title = (ta && video.title_ta) || video.title;
  const description = (ta && video.description_ta) || video.description;
  const yt = video.provider === 'youtube' ? youtubeId(video.url) : null;
  const poster = video.thumbnail_url ?? (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: Math.min(index * 0.06, 0.3) }}>
      <Card className="h-full overflow-hidden">
        <div className="relative aspect-video bg-muted">
          {playing ? (
            yt ? (
              <iframe
                className="absolute inset-0 size-full"
                src={`https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0`}
                title={title}
                allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            ) : (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video className="absolute inset-0 size-full bg-black" src={video.url} controls autoPlay playsInline />
            )
          ) : (
            <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 flex items-center justify-center" aria-label={t('videos.play', { title })}>
              {poster ? <img src={poster} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" /> : <VideoIcon className="size-10 text-muted-foreground" aria-hidden />}
              <span className="absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/40" />
              <span className="relative inline-flex size-14 items-center justify-center rounded-full bg-white text-slate-900 shadow-xl transition-transform group-hover:scale-110">
                <Play className="ml-0.5 size-6 fill-current" aria-hidden />
              </span>
            </button>
          )}
        </div>
        <div className="space-y-1.5 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-snug">{title}</h3>
            <Badge tone="outline" className="shrink-0">{t(`videoCategory.${video.category}`, { defaultValue: video.category })}</Badge>
          </div>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </Card>
    </motion.div>
  );
}

export function VideoGallery({ audience }: { audience: 'public' | 'all' }) {
  const { t } = useTranslation();
  const query = useVideos(audience);
  return (
    <QueryState
      query={query}
      skeleton={<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-video rounded-xl" />)}</div>}
      empty={<EmptyState icon={VideoIcon} title={t('videos.emptyTitle')} description={t('videos.emptyBody')} />}
    >
      {(videos) => (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v, i) => <VideoCard key={v.id} video={v} index={i} />)}
        </div>
      )}
    </QueryState>
  );
}
