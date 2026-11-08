"use client";

import { Children, isValidElement, useEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { CustomDropdown, type CustomDropdownOption } from "./custom-dropdown";

function optionText(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? optionText(child.props.children) : String(child ?? "")).join("");
}

/** Keeps native form submission and validation behind the shared custom UI. */
export function CustomSelect({ children, value, defaultValue, onChange, className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const native = useRef<HTMLSelectElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const options: CustomDropdownOption[] = [];
  function collect(nodes: ReactNode, disabled = false) {
    Children.forEach(nodes, child => {
      if (!isValidElement<{ children?: ReactNode; value?: string | number; disabled?: boolean }>(child)) return;
      if (child.type === "option") options.push({ value: String(child.props.value ?? optionText(child.props.children)), label: optionText(child.props.children), disabled: disabled || child.props.disabled });
      else collect(child.props.children, disabled || Boolean(child.props.disabled));
    });
  }
  collect(children);
  const [localValue, setLocalValue] = useState(String(defaultValue ?? options[0]?.value ?? ""));
  const selected = String(value ?? localValue);
  const firstValue = options[0]?.value ?? "";
  useEffect(() => {
    const form = native.current?.form;
    const reset = () => setLocalValue(String(defaultValue ?? firstValue));
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, [defaultValue, firstValue]);
  return <div className={`shahvex-select ${className || ""}`} ref={wrapper}>
    <select {...props} ref={native} value={selected} tabIndex={-1} aria-hidden="true" className="shahvex-select-native"
      onInvalid={event => { event.preventDefault(); wrapper.current?.querySelector<HTMLButtonElement>(".custom-dropdown-trigger")?.focus(); props.onInvalid?.(event); }}
      onChange={event => { setLocalValue(event.target.value); onChange?.(event); }}>
      {children}
    </select>
    <CustomDropdown value={selected} options={options} disabled={props.disabled}
      ariaLabel={props["aria-label"] || props.name || "Select an option"}
      onChange={next => {
        if (!native.current) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
        setter?.call(native.current, next);
        native.current.dispatchEvent(new Event("change", { bubbles: true }));
      }} />
  </div>;
}
