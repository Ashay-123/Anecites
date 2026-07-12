import {
  Children,
  cloneElement,
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "small" | "default" | "icon";

export interface ButtonProps extends ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "default",
    loading = false,
    disabled,
    className,
    children,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("ui-button", className)}
      data-variant={variant}
      data-size={size}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="ui-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});

export const Input = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<"input">>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cx("ui-input", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<"textarea">>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cx("ui-textarea", className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, ComponentPropsWithoutRef<"select">>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cx("ui-select", className)} {...props}>
      {children}
    </select>
  );
});

export interface FieldProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean | undefined;
}

export function Field({ label, htmlFor, children, error, hint, required = false }: FieldProps): ReactElement {
  return (
    <div className="ui-field" data-invalid={Boolean(error) || undefined}>
      <label className="ui-label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="ui-required" aria-hidden="true">*</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p className="ui-field-hint" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="ui-field-error" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface BadgeProps extends ComponentPropsWithoutRef<"span"> {
  tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className, children, ...props }: BadgeProps): ReactElement {
  return (
    <span className={cx("ui-badge", className)} data-tone={tone} {...props}>
      <span className="ui-badge-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export interface CardProps extends ComponentPropsWithoutRef<"section"> {
  padding?: "none" | "compact" | "default";
}

export function Card({ padding = "default", className, children, ...props }: CardProps): ReactElement {
  return (
    <section className={cx("ui-card", className)} data-padding={padding} {...props}>
      {children}
    </section>
  );
}

export interface SeparatorProps extends ComponentPropsWithoutRef<"div"> {
  orientation?: "horizontal" | "vertical";
}

export function Separator({ orientation = "horizontal", className, ...props }: SeparatorProps): ReactElement {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cx("ui-separator", className)}
      data-orientation={orientation}
      {...props}
    />
  );
}

export interface SwitchProps
  extends Omit<ComponentPropsWithoutRef<"button">, "children" | "onChange" | "onClick" | "role"> {
  checked: boolean;
  label: string;
  onCheckedChange?: ((checked: boolean) => void) | undefined;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, label, onCheckedChange, className, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx("ui-switch", className)}
      data-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    >
      <span className="ui-switch-thumb" aria-hidden="true" />
    </button>
  );
});

interface TooltipChildProps {
  "aria-describedby"?: string;
}

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement<TooltipChildProps>;
}

export function Tooltip({ content, children }: TooltipProps): ReactElement {
  const tooltipId = useId();
  const child = Children.only(children);
  const describedBy = [child.props["aria-describedby"], tooltipId].filter(Boolean).join(" ");

  return (
    <span className="ui-tooltip-root">
      {cloneElement(child, { "aria-describedby": describedBy })}
      <span className="ui-tooltip" id={tooltipId} role="tooltip">
        {content}
      </span>
    </span>
  );
}

export interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  label: string;
  items: readonly MenuItem[];
  align?: "start" | "end";
}

export function Menu({ label, items, align = "start" }: MenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => findEnabledIndex(items, 0, 1));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open && activeIndex >= 0) {
      itemRefs.current[activeIndex]?.focus();
    }
  }, [activeIndex, open]);

  function openAt(index: number): void {
    if (!items.some((item) => !item.disabled)) {
      return;
    }

    setActiveIndex(index);
    setOpen(true);
  }

  function moveFocus(direction: 1 | -1): void {
    const nextIndex = findEnabledIndex(items, activeIndex + direction, direction);
    if (nextIndex >= 0) {
      setActiveIndex(nextIndex);
    }
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openAt(findEnabledIndex(items, 0, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt(findEnabledIndex(items, items.length - 1, -1));
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(findEnabledIndex(items, 0, 1));
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(findEnabledIndex(items, items.length - 1, -1));
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="ui-menu-root" ref={rootRef}>
      <Button
        ref={triggerRef}
        variant="secondary"
        disabled={!items.some((item) => !item.disabled)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openAt(findEnabledIndex(items, 0, 1));
          }
        }}
        onKeyDown={onTriggerKeyDown}
      >
        {label}
        <span className="ui-menu-chevron" aria-hidden="true">v</span>
      </Button>
      {open ? (
        <div
          className="ui-menu"
          data-align={align}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              className="ui-menu-item"
              disabled={item.disabled}
              tabIndex={index === activeIndex ? 0 : -1}
              onMouseEnter={() => {
                if (!item.disabled) {
                  setActiveIndex(index);
                }
              }}
              onClick={() => {
                item.onSelect();
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface StatePanelProps {
  title: string;
  description: string;
  tone?: "default" | "danger";
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function StatePanel({ title, description, tone = "default", action }: StatePanelProps): ReactElement {
  return (
    <section className="ui-state-panel" data-tone={tone} role={tone === "danger" ? "alert" : undefined}>
      <span className="ui-state-symbol" aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action ? (
        <Button variant="secondary" size="small" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </section>
  );
}

function findEnabledIndex(items: readonly MenuItem[], start: number, direction: 1 | -1): number {
  if (items.length === 0) {
    return -1;
  }

  for (let offset = 0; offset < items.length; offset += 1) {
    const index = (start + offset * direction + items.length) % items.length;
    if (!items[index]?.disabled) {
      return index;
    }
  }

  return -1;
}

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
