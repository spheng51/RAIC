'use client';

import { useRef, useEffect, useCallback } from 'react';
import { debounce } from 'lodash';
import { useCanvasStore } from '@/lib/store';
import { useHistorySnapshot } from '@/lib/hooks/use-history-snapshot';
import type { PPTTextElement } from '@/lib/types/slides';
import { useElementShadow } from '../hooks/useElementShadow';
import { ElementOutline } from '../ElementOutline';
import { ProsemirrorEditor } from '../ProsemirrorEditor';
import { useCanvasOperations } from '@/lib/hooks/use-canvas-operations';

export interface TextElementProps {
  elementInfo: PPTTextElement;
  selectElement?: (
    e: React.MouseEvent | React.TouchEvent,
    element: PPTTextElement,
    canMove?: boolean,
  ) => void;
}

/**
 * Editable text element component
 * Includes auto-height adjustment and empty text cleanup
 */
export function TextElement({ elementInfo, selectElement }: TextElementProps) {
  const handleElementId = useCanvasStore.use.handleElementId();
  const isScaling = useCanvasStore.use.isScaling();
  const { updateElement, deleteElement } = useCanvasOperations();
  const { addHistorySnapshot } = useHistorySnapshot();

  const { shadowStyle } = useElementShadow(elementInfo.shadow);

  const elementRef = useRef<HTMLDivElement>(null);
  const wasScalingRef = useRef(false);

  const handleSelectElement = (e: React.MouseEvent | React.TouchEvent, canMove = true) => {
    if (elementInfo.lock) return;
    e.stopPropagation();
    selectElement?.(e, elementInfo, canMove);
  };

  // Check if element is being handled
  const isHandleElement = handleElementId === elementInfo.id;

  const applyMeasuredTextSize = useCallback(
    (size: { width: number; height: number }) => {
      if (!elementRef.current || isScaling) return;

      const realHeight = size.height + 20;
      const realWidth = size.width + 20;

      if (!elementInfo.vertical && elementInfo.height !== realHeight) {
        updateElement({
          id: elementInfo.id,
          props: { height: realHeight },
        });
      }
      if (elementInfo.vertical && elementInfo.width !== realWidth) {
        updateElement({
          id: elementInfo.id,
          props: { width: realWidth },
        });
      }
    },
    [
      elementInfo.height,
      elementInfo.id,
      elementInfo.vertical,
      elementInfo.width,
      isScaling,
      updateElement,
    ],
  );

  // Monitor text element size changes
  const updateTextElementHeight = useCallback(
    (entries: ResizeObserverEntry[]) => {
      const contentRect = entries[0].contentRect;
      applyMeasuredTextSize(contentRect);
    },
    [applyMeasuredTextSize],
  );

  useEffect(() => {
    if (isScaling) {
      wasScalingRef.current = true;
      return;
    }

    if (!wasScalingRef.current) return;
    wasScalingRef.current = false;

    const frame = window.requestAnimationFrame(() => {
      const rect = elementRef.current?.getBoundingClientRect();
      if (!rect) return;

      applyMeasuredTextSize({
        width: Math.max(0, rect.width - 20),
        height: Math.max(0, rect.height - 20),
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [applyMeasuredTextSize, isScaling]);

  // ResizeObserver setup
  useEffect(() => {
    const el = elementRef.current;
    const resizeObserver = new ResizeObserver(updateTextElementHeight);
    if (el) {
      resizeObserver.observe(el);
    }
    return () => {
      if (el) {
        resizeObserver.unobserve(el);
      }
    };
  }, [updateTextElementHeight]);

  // Update content
  const updateContent = useCallback(
    (content: string, ignore = false) => {
      updateElement({
        id: elementInfo.id,
        props: { content },
      });

      if (!ignore) addHistorySnapshot();
    },
    [elementInfo.id, updateElement, addHistorySnapshot],
  );

  // Check and delete empty text
  const checkEmptyText = useCallback(() => {
    const debouncedCheck = debounce(
      () => {
        const pureText = elementInfo.content.replace(/<[^>]+>/g, '');
        if (!pureText) deleteElement(elementInfo.id);
      },
      300,
      { trailing: true },
    );
    debouncedCheck();
  }, [elementInfo.content, elementInfo.id, deleteElement]);

  // Check empty text when element is no longer handled
  useEffect(() => {
    if (!isHandleElement) {
      checkEmptyText();
    }
  }, [isHandleElement, checkEmptyText]);

  return (
    <div
      className={`editable-element-text absolute ${elementInfo.lock ? 'lock' : ''}`}
      style={{
        top: `${elementInfo.top}px`,
        left: `${elementInfo.left}px`,
        width: `${elementInfo.width}px`,
        height: `${elementInfo.height}px`,
      }}
    >
      <div
        className="rotate-wrapper w-full h-full"
        style={{ transform: `rotate(${elementInfo.rotate}deg)` }}
      >
        <div
          ref={elementRef}
          className={`element-content relative p-[10px] leading-[1.5] break-words ${elementInfo.lock ? 'cursor-default' : 'cursor-move'}`}
          style={{
            width: elementInfo.vertical ? 'auto' : `${elementInfo.width}px`,
            height: elementInfo.vertical ? `${elementInfo.height}px` : 'auto',
            backgroundColor: elementInfo.fill,
            opacity: elementInfo.opacity,
            textShadow: shadowStyle,
            lineHeight: elementInfo.lineHeight,
            letterSpacing: `${elementInfo.wordSpace || 0}px`,
            color: elementInfo.defaultColor,
            fontFamily: elementInfo.defaultFontName,
            writingMode: elementInfo.vertical ? 'vertical-rl' : 'horizontal-tb',
            // @ts-expect-error - CSS custom property
            '--paragraphSpace': `${elementInfo.paragraphSpace === undefined ? 5 : elementInfo.paragraphSpace}px`,
          }}
          onMouseDown={(e) => handleSelectElement(e)}
          onTouchStart={(e) => handleSelectElement(e)}
        >
          <ElementOutline
            width={elementInfo.width}
            height={elementInfo.height}
            outline={elementInfo.outline}
          />

          <div className="text relative">
            <ProsemirrorEditor
              elementId={elementInfo.id}
              defaultColor={elementInfo.defaultColor}
              defaultFontName={elementInfo.defaultFontName}
              editable={!elementInfo.lock}
              value={elementInfo.content}
              onUpdate={({ value, ignore }) => updateContent(value, ignore)}
              onMouseDown={(e) => handleSelectElement(e as React.MouseEvent, false)}
            />
          </div>

          {/* Drag handlers for better interaction when text overflows */}
          <div className="drag-handler top absolute left-0 right-0 h-[10px] top-0" />
          <div className="drag-handler bottom absolute left-0 right-0 h-[10px] bottom-0" />
        </div>
      </div>
    </div>
  );
}
