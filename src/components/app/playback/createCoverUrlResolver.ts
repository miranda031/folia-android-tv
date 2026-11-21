import type { SongResult } from '../../../types';
import { isAndroidTv } from '../../../platform/runtime';
import { getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';
import { toSafeRemoteUrl } from '../../../utils/appPlaybackHelpers';
import { getSizedCoverUrl } from '../../../utils/coverUrl';

// src/components/app/playback/createCoverUrlResolver.ts

const TV_MAX_PLAYING_COVER_SIZE = 512;

// Resolves the effective cover URL by preferring the cached cover over remote metadata.
export const createCoverUrlResolver = (
    cachedCoverUrl: string | null,
    currentSong: SongResult | null,
) => {
    return () => {
        if (cachedCoverUrl) return cachedCoverUrl;
        const url = getSongCoverUrl(currentSong) || null;
        const safeUrl = toSafeRemoteUrl(url) || null;
        if (!safeUrl) return null;
        // 电视端限制单曲播放封面最大请求尺寸为 512×512，防止直接解码 3000×3000 原图（单张占用 36MB 显存）导致闪退
        return isAndroidTv() ? (getSizedCoverUrl(safeUrl, TV_MAX_PLAYING_COVER_SIZE) || safeUrl) : safeUrl;
    };
};
