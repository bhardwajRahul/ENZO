// Slider — Base UI primitive (21st.dev / shadcn-style): accessible slider with
// native horizontal/vertical orientation, drag + keyboard, and edge-aligned
// thumbs. Adapted for this codebase: relative imports (tsconfig has no `@/`
// path mapping) and Tailwind 3 class equivalents for the upstream Tailwind 4
// utilities (min-h-44 → min-h-[11rem], size-5 → h-5 w-5, not-dark: dropped for
// an explicit light/dark pair, opacity-64 → opacity-60, scale-120 → scale-[1.2]).

"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "../../lib/utils";
import * as React from "react";

export function Slider({
  className,
  children,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props): React.ReactElement {
  const _values = React.useMemo(() => {
    if (value !== undefined) return Array.isArray(value) ? value : [value];
    if (defaultValue !== undefined) return Array.isArray(defaultValue) ? defaultValue : [defaultValue];
    return [min];
  }, [value, defaultValue, min]);

  return (
    <SliderPrimitive.Root
      className={cn("data-[orientation=horizontal]:w-full", className)}
      defaultValue={defaultValue}
      max={max}
      min={min}
      thumbAlignment="edge"
      value={value}
      {...props}
    >
      {children}
      <SliderPrimitive.Control
        className="flex touch-none select-none data-disabled:pointer-events-none data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-[11rem] data-[orientation=horizontal]:w-full data-[orientation=horizontal]:min-w-[11rem] data-[orientation=vertical]:flex-col data-disabled:opacity-60"
        data-slot="slider-control"
      >
        <SliderPrimitive.Track
          className="relative grow select-none before:absolute before:rounded-full before:bg-input data-[orientation=horizontal]:h-1 data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-1 data-[orientation=horizontal]:before:inset-x-0.5 data-[orientation=vertical]:before:inset-x-0 data-[orientation=horizontal]:before:inset-y-0 data-[orientation=vertical]:before:inset-y-0.5"
          data-slot="slider-track"
        >
          <SliderPrimitive.Indicator
            className="select-none rounded-full bg-primary data-[orientation=horizontal]:ms-0.5 data-[orientation=vertical]:mb-0.5"
            data-slot="slider-indicator"
          />
          {Array.from({ length: _values.length }, (_, index) => (
            <SliderPrimitive.Thumb
              className="block h-5 w-5 shrink-0 select-none rounded-full border border-input bg-white bg-clip-padding shadow-[0_1px_2px_rgba(0,0,0,0.05)] outline-none transition-[box-shadow,scale] dark:border-background dark:shadow-none sm:h-4 sm:w-4"
              data-slot="slider-thumb"
              index={index}
              key={String(index)}
            />
          ))}
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export function SliderValue({
  className,
  ...props
}: SliderPrimitive.Value.Props): React.ReactElement {
  return (
    <SliderPrimitive.Value
      className={cn("flex justify-end text-sm", className)}
      data-slot="slider-value"
      {...props}
    />
  );
}

export { SliderPrimitive };
