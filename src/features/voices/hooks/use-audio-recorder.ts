/**
 * 浏览器麦克风录音 Hook。
 * - 使用 RecordRTC 输出单声道 WAV（44.1kHz）。
 * - 使用 WaveSurfer Record 插件在同一 MediaStream 上绘制实时波形（需将 containerRef 绑到 DOM）。
 */

import { useState, useRef, useCallback, useEffect } from "react";
import type RecordRTCType from "recordrtc";
import WaveSurfer from "wavesurfer.js";
import RecordPlugin from "wavesurfer.js/dist/plugins/record.esm.js";

export function useAudioRecorder() {
  // UI 状态
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  // RecordRTC / 麦克风流 / 计时器
  const recorderRef = useRef<RecordRTCType | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 波形画布挂载点，由使用方传入 */
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  /** renderMicStream 返回的句柄，销毁时需先 onDestroy 再 destroy WaveSurfer */
  const micStreamRef = useRef<{ onDestroy: () => void } | null>(null);

  const destroyWaveSurfer = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.onDestroy();
      micStreamRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.destroy();
      wsRef.current = null;
    }
  }, []);

  /** 释放计时器、录音器、媒体轨道与波形实例，避免泄漏 */
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current) {
      recorderRef.current.destroy();
      recorderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    destroyWaveSurfer();
  }, [destroyWaveSurfer]);

  // isRecording 为 true 且容器已挂载、流已就绪后创建波形图
  // 与 stream 共用 getUserMedia 的同一轨
  useEffect(() => {
    if (!isRecording || !containerRef.current || !streamRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "hsl(var(--foreground) / 0.5)",
      height: 144,
      barWidth: 1,
      barGap: 2,
      barRadius: 1,
      cursorWidth: 0,
      barMinHeight: 10,
      barHeight: 2,
      normalize: true,
    });

    wsRef.current = ws;

    // 注册 WaveSurfer Record 插件
    const record = ws.registerPlugin(
      RecordPlugin.create({
        scrollingWaveform: true,
      }),
    );

    const handle = record.renderMicStream(streamRef.current);
    micStreamRef.current = handle;

    return () => {
      destroyWaveSurfer();
    };
  }, [isRecording, destroyWaveSurfer]);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setAudioBlob(null);
      setElapsedTime(0);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = stream;

      // 动态加载 recordrtc，便于代码分割
      const { default: RecordRTC, StereoAudioRecorder } = await import(
        "recordrtc"
      );

      const recorder = new RecordRTC(stream, {
        recorderType: StereoAudioRecorder,
        mimeType: "audio/wav",
        numberOfAudioChannels: 1,
        desiredSampRate: 44100,
      });

      recorderRef.current = recorder;
      recorder.startRecording();
      setIsRecording(true);

      // 设置计时器，每 100ms 更新一次已录时长
        const startTime = Date.now();
        timerRef.current = setInterval(() => {
          setElapsedTime((Date.now() - startTime) / 1000);
        }, 100);
    } catch (err) {
      cleanup();

      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError(
          "Microphone access denied. Please allow microphone access in your browser settings.",
        );
      } else {
        setError("Failed to access microphone. Please check your device.");
      }
    }
  }, [cleanup]);

  const stopRecording = useCallback(
    (onBlob?: (blob: Blob) => void) => {
      const recorder = recorderRef.current;
      if (!recorder) return;

      recorder.stopRecording(() => {
        // 获取 Blob 对象
        // Blob 代表的是一段二进制数据，可以是文本、音频、视频、图片等的二进制形式
        const blob = recorder.getBlob();
        setAudioBlob(blob);
        setIsRecording(false);
        cleanup();
        onBlob?.(blob);
      });
    },
    [cleanup]);

  /** 取消或重录：不依赖 stop 回调，直接释放资源并清空状态 */
  const resetRecording = useCallback(() => {
    cleanup();
    setIsRecording(false);
    setElapsedTime(0);
    setAudioBlob(null);
    setError(null);
  }, [cleanup]);

  return {
    isRecording,
    elapsedTime,
    audioBlob,
    containerRef,
    error,
    startRecording,
    stopRecording,
    resetRecording,
  };
};
