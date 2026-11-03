import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

/** Bottom sheet used for the add/edit forms. Closes on backdrop tap or Escape. */
export function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);
  return (
    <div class="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal__box">
        <div class="modal__head">
          <h2>{title}</h2>
          <button class="icon-btn" onClick={onClose} aria-label="סגור">
            ✕
          </button>
        </div>
        <div class="modal__body">{children}</div>
      </div>
    </div>
  );
}

const URL_RE = /(https?:\/\/[^\s]+)/g;

/** Text with http(s) links made clickable; everything else shown as typed. */
export function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a href={part} target="_blank" rel="noopener noreferrer" dir="ltr">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}
