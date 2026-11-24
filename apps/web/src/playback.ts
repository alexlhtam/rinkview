import { useEffect, useMemo, useRef, useState } from 'react';
import type { PositionSource } from './data';
import { MAX_TRAIL_SECONDS, WINDOW_SECONDS } from './samples';
import type { Sample } from './samples';

export function fallbackFrameTarget(time: number, direction: -1 | 1, fps: number, duration: number) {
  const tolerance = 1e-7;
  const current = Math.floor(time * fps + tolerance);
  const last = Math.max(0, Math.ceil(duration * fps - tolerance) - 1);
  const frame = Math.min(last, Math.max(0, current + direction));
  const start = frame / fps;
  return start + Math.min(0.25 / fps, (duration - start) / 2);
}

export function usePlayback() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastFrame = useRef<number | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let callback = 0;
    const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function';
    const nextFrame: VideoFrameRequestCallback = (_, metadata) => {
      lastFrame.current = metadata.mediaTime;
      setTime(metadata.mediaTime);
      callback = video.requestVideoFrameCallback(nextFrame);
    };
    if (hasFrameCallback) callback = video.requestVideoFrameCallback(nextFrame);
    const updateDuration = () => setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    const updateTime = () => setTime(video.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => { onPause(); updateTime(); };
    const onError = () => setError('This video could not be decoded. Try an H.264 MP4.');
    const listeners: [string, EventListener][] = [
      ['durationchange', updateDuration], ['play', onPlay], ['pause', onPause], ['ended', onEnd], ['error', onError],
    ];
    if (!hasFrameCallback) listeners.push(['timeupdate', updateTime], ['seeked', updateTime]);
    for (const [name, listen] of listeners) video.addEventListener(name, listen);
    updateDuration();
    if (video.error) onError();
    return () => {
      if (hasFrameCallback) video.cancelVideoFrameCallback(callback);
      for (const [name, listen] of listeners) video.removeEventListener(name, listen);
    };
  }, []);

  function seek(target: number) {
    const video = videoRef.current;
    if (!video || !duration) return;
    video.currentTime = Math.max(0, Math.min(duration, target));
  }

  function step(direction: -1 | 1, fps: number) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const displayed = lastFrame.current;
    seek(displayed === null
      ? fallbackFrameTarget(video.currentTime, direction, fps, duration)
      : displayed + (direction + 0.25) / fps);
  }

  function changeSpeed(rate: number) {
    if (videoRef.current) videoRef.current.playbackRate = rate;
    setSpeed(rate);
  }

  async function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) video.pause();
    else {
      try {
        await video.play();
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError('Playback could not start. Try another video format.');
      }
    }
  }

  return { videoRef, time, duration, playing, speed, error, seek, step, changeSpeed, toggle };
}

export function usePositionWindow(source: PositionSource, time: number) {
  const key = Math.floor(time / WINDOW_SECONDS);
  const windows = useMemo(() => positionWindows(source), [source]);
  const [loaded, setLoaded] = useState<Sample[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    windows.prune(key);
    void windows.get(key).then(samples => {
      if (!active) return;
      setError('');
      setLoaded(samples);
    }, () => {
      if (active) setError('Could not load positions for this part of the video.');
    });
    void windows.get(key + 1).catch(() => {});
    return () => { active = false; };
  }, [windows, key]);
  return { samples: loaded, windowError: error };
}

function positionWindows(source: PositionSource) {
  const cache = new Map<number, Promise<Sample[]>>();
  return {
    get(index: number) {
      const existing = cache.get(index);
      if (existing) return existing;
      const start = index * WINDOW_SECONDS;
      const pending = source.readWindow(Math.max(0, start - MAX_TRAIL_SECONDS - 0.2), start + WINDOW_SECONDS + 0.2)
        .catch((cause: unknown) => {
          if (cache.get(index) === pending) cache.delete(index);
          throw cause;
        });
      cache.set(index, pending);
      return pending;
    },
    prune(key: number) {
      for (const index of cache.keys()) if (index < key - 1 || index > key + 1) cache.delete(index);
    },
  };
}
