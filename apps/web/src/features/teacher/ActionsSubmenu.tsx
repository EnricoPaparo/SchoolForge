import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconChevronLeft, IconChevronRight } from '../../components/icons.js';
import styles from './CourseWorkspace.module.css';

/** A flyout on pointer devices; an in-panel next level on touch screens. */
export function ActionsSubmenu({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(
    () => window.innerWidth <= 640 || !!window.matchMedia?.('(pointer: coarse)').matches,
  );
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const cancelClose = () => clearTimeout(timer.current);
  const close = () => {
    setOpen(false);
    if (mobile) requestAnimationFrame(() => trigger.current?.focus());
    else trigger.current?.focus();
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const update = () =>
      setMobile(window.innerWidth <= 640 || !!window.matchMedia?.('(pointer: coarse)').matches);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const compute = () => {
      if (!trigger.current || !panel.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const width = panel.current.offsetWidth;
      setPosition({
        left: Math.max(
          8,
          Math.min(
            rect.right + width <= window.innerWidth - 8 ? rect.right : rect.left - width,
            window.innerWidth - width - 8,
          ),
        ),
        top: Math.max(
          8,
          Math.min(
            rect.top,
            window.innerHeight - Math.min(panel.current.scrollHeight, window.innerHeight - 16) - 8,
          ),
        ),
      });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, mobile]);
  const openAndFocus = () => {
    cancelClose();
    setOpen(true);
    requestAnimationFrame(() =>
      panel.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus(),
    );
  };
  return (
    <div
      className={styles.submenuBranch}
      onPointerEnter={(event) => {
        if (!mobile && event.pointerType !== 'touch') {
          cancelClose();
          setOpen(true);
        }
      }}
      onPointerLeave={() => {
        if (!mobile) timer.current = setTimeout(() => setOpen(false), 250);
      }}
      onKeyDown={(event) => {
        if (open && (event.key === 'Escape' || event.key === 'ArrowLeft')) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={open && mobile ? styles.submenuHiddenTrigger : undefined}
        onClick={openAndFocus}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            openAndFocus();
          }
        }}
      >
        {icon}
        <span>{label}</span>
        <IconChevronRight size={15} />
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="menu"
          aria-label={label}
          className={mobile ? styles.submenuMobile : `${styles.menu} ${styles.submenuFlyout}`}
          style={mobile ? undefined : { left: position.left, top: position.top }}
        >
          {mobile && (
            <div className={styles.submenuHeading}>
              <button type="button" aria-label={`Indietro da ${label}`} onClick={close}>
                <IconChevronLeft size={18} />
                Indietro
              </button>
              <strong>{label}</strong>
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
