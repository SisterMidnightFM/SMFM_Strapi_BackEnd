/**
 * XHR-based upload so we can show real progress — the admin's fetch-based
 * client (getFetchClient) has no upload-progress support.
 */

export interface UploadHandle {
  promise: Promise<{ trackId: string; warnings: string[] }>;
  abort: () => void;
}

export function uploadWithProgress({
  path,
  token,
  file,
  onProgress,
}: {
  path: string;
  token: string;
  file: File;
  /** 0-100 while the browser sends; null once the server is forwarding to Radio Cult */
  onProgress: (percent: number | null) => void;
}): UploadHandle {
  const xhr = new XMLHttpRequest();
  const backendURL = (window as any).strapi?.backendURL ?? '';

  const promise = new Promise<{ trackId: string; warnings: string[] }>((resolve, reject) => {
    xhr.open('POST', `${backendURL}${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.responseType = 'json';
    xhr.timeout = 0; // large files legitimately take a long time

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    // Browser→Strapi transfer finished; Strapi→Radio Cult still in flight.
    xhr.upload.onload = () => onProgress(null);

    xhr.onload = () => {
      const body = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
      } else {
        reject(
          Object.assign(new Error(body?.error ?? `Upload failed (HTTP ${xhr.status})`), {
            status: xhr.status,
          })
        );
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled'), { cancelled: true }));

    const formData = new FormData();
    formData.append('files', file, file.name);
    xhr.send(formData);
  });

  return { promise, abort: () => xhr.abort() };
}
