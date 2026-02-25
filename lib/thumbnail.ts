'use client'

/**
 * Client-side thumbnail capture and upload utilities.
 *
 * captureVideoThumbnail: Creates a hidden <video>, seeks to a frame, draws to canvas, exports as JPEG blob.
 * uploadThumbnail: POSTs the blob to the thumbnail API endpoint.
 */

export interface CaptureOptions {
  /** Time in seconds to seek to. Defaults to 2. */
  seekTime?: number
  /** Max width of the output image. Defaults to 640. */
  maxWidth?: number
  /** JPEG quality (0-1). Defaults to 0.8. */
  quality?: number
}

const DEFAULT_OPTIONS: Required<CaptureOptions> = {
  seekTime: 2,
  maxWidth: 640,
  quality: 0.8,
}

/**
 * Capture a thumbnail frame from a video source URL.
 *
 * Creates a hidden <video> element, seeks to the specified time,
 * draws the frame to an offscreen canvas, and exports as a JPEG blob.
 *
 * Note: The video source must support CORS (crossOrigin = 'anonymous')
 * for canvas access to work. R2 signed URLs need proper CORS headers.
 */
export async function captureVideoThumbnail(
  videoSrc: string,
  options?: CaptureOptions
): Promise<Blob> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  return new Promise<Blob>((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true

    // Clean up the video element after capture
    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
    }

    video.addEventListener('loadedmetadata', () => {
      // Clamp seek time to prevent seeking past the end of short videos
      const seekTarget = Math.min(opts.seekTime, video.duration * 0.25)
      video.currentTime = seekTarget
    })

    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas')

        // Calculate dimensions maintaining aspect ratio
        const scale = Math.min(1, opts.maxWidth / video.videoWidth)
        canvas.width = Math.round(video.videoWidth * scale)
        canvas.height = Math.round(video.videoHeight * scale)

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          cleanup()
          reject(new Error('Failed to get canvas 2D context'))
          return
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        canvas.toBlob(
          (blob) => {
            cleanup()
            if (!blob) {
              reject(new Error('Failed to export canvas to blob'))
              return
            }
            resolve(blob)
          },
          'image/jpeg',
          opts.quality
        )
      } catch (err) {
        cleanup()
        reject(err)
      }
    })

    video.addEventListener('error', () => {
      cleanup()
      reject(new Error('Failed to load video for thumbnail capture'))
    })

    video.src = videoSrc
  })
}

/**
 * Upload a thumbnail blob to the server.
 */
export async function uploadThumbnail(videoId: string, blob: Blob): Promise<{ success: boolean }> {
  const response = await fetch(`/api/videos/${videoId}/thumbnail`, {
    method: 'POST',
    headers: {
      'Content-Type': blob.type || 'image/jpeg',
    },
    body: blob,
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? `Upload failed: ${response.status}`)
  }

  return response.json() as Promise<{ success: boolean }>
}
