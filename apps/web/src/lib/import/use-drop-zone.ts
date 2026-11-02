'use client';

import { type DragEvent, useEffect, useRef, useState } from 'react';

/**
 * A drop area for files (the single uploader and the folder import share it). It tracks whether a
 * file is being dragged over the area and hands the drop's `DataTransfer` to `onDrop` while the
 * drop event is still running (the browser empties it once the handler returns).
 *
 * The page keeps one guard against a file dropped beside an area, which would make the browser
 * open the file and leave the page (losing every list): it is registered once for the whole page,
 * however many drop areas are on it, and removed when the last one goes.
 */

let guardUsers = 0;

function keepPage(event: globalThis.DragEvent): void {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
}

function holdPageGuard(): () => void {
  if (guardUsers === 0) {
    window.addEventListener('dragover', keepPage);
    window.addEventListener('drop', keepPage);
  }
  guardUsers++;
  return () => {
    guardUsers--;
    if (guardUsers === 0) {
      window.removeEventListener('dragover', keepPage);
      window.removeEventListener('drop', keepPage);
    }
  };
}

/** How many drop areas currently hold the page guard (for tests). */
export function pageGuardUsers(): number {
  return guardUsers;
}

export interface DropZone {
  readonly dragging: boolean;
  readonly handlers: {
    readonly onDragEnter: (event: DragEvent<HTMLElement>) => void;
    readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
    readonly onDragLeave: (event: DragEvent<HTMLElement>) => void;
    readonly onDrop: (event: DragEvent<HTMLElement>) => void;
  };
}

export function useDropZone(onDrop: (transfer: DataTransfer) => void): DropZone {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onDrop);
  latest.current = onDrop;

  useEffect(() => holdPageGuard(), []);

  const over = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };
  return {
    dragging,
    handlers: {
      onDragEnter: over,
      onDragOver: over,
      onDragLeave: (event) => {
        const to = event.relatedTarget;
        if (to instanceof Node && event.currentTarget.contains(to)) return;
        setDragging(false);
      },
      onDrop: (event) => {
        event.preventDefault();
        setDragging(false);
        latest.current(event.dataTransfer);
      },
    },
  };
}
