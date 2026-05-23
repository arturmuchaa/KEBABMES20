"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({
  className,
  children,
  position = "popper",
  side = "bottom",
  align = "start",
  sideOffset = 4,
  alignOffset = 0,
  avoidCollisions = false,
  ...props
}, ref) => {
  // === ROOT-CAUSE BUGA "opcje uciekają obok triggera przy zoom 125/150%" ===
  //
  // Aplikacja używa custom hooka `useZoom` (features/ui/useZoom.ts) który
  // ustawia `document.documentElement.style.zoom = '125%'` (auto-detect dla
  // monitorów 2K/4K + Ctrl + = / Ctrl + −). To NIE jest browser zoom (Ctrl++);
  // to CSS `zoom` property na <html>.
  //
  // Radix Popper (floating-ui) bierze getBoundingClientRect triggera (zwraca
  // POST-zoom CSS px, np. y=158 przy realnym y=126) i wpisuje te wartości jako
  // `transform: translate3d(x, y, 0)` na popper-wrapper. Wrapper jest dzieckiem
  // <body> które jest wewnątrz zoomowanego <html> → transform jest skalowany
  // PONOWNIE przez zoom. Visual y = 158/1.25 × 1.25 → ale 158 to już post-zoom,
  // więc visual y staje się 158 × 1.25 = 197.5. Popover ląduje ~40-200px obok
  // i poniżej triggera ("rozsypane luzem", "ucieka do góry").
  //
  // Fix: po otwarciu popper'a kompensujemy `zoom` na wrapperze (1/zoom) tak żeby
  // transform Radixa trafił w prawidłowe visual pixele, a na Content stosujemy
  // `zoom = htmlZoom` żeby treść popover'a miała ten sam rozmiar co reszta UI.
  // Net effect: pozycja idealnie pod triggerem + rozmiar zgodny z aplikacją.
  //
  // Sprawdzone w Playwright przy html.zoom=125%: trigger.x=74,bottom=158.375
  // → wrapper.x=74, wrapper.y=162 (gap 3.625 = sideOffset 4). Bez kompensacji
  // wrapper był (92.5, 202.5) — 18px w prawo, 44px niżej.
  // Kompensacja CSS-zoom na <html> jest robiona globalnie przez MutationObserver
  // zarejestrowany w useZoomInit (features/ui/useZoom.ts) — łapie KAŻDY
  // `[data-radix-popper-content-wrapper]` przy pojawieniu się w DOM (Select,
  // DropdownMenu, Tooltip, etc.) i koryguje pozycję+rozmiar.
  return (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      side={side}
      align={align}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      avoidCollisions={avoidCollisions}
      className={cn(
        // max-h przekazywane do --radix-select-content-available-height — ogranicza wysokość
        // dropdownu, gdy nie mieści się między triggerem a krawędzią okna.
        "relative z-[100] max-h-[min(384px,var(--radix-select-content-available-height,384px))] min-w-[8rem] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-modal",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      {/*
        BUG: Stary szablon shadcn ustawiał Viewport h-[var(--radix-select-trigger-height)]
        — czyli wymuszał wysokość Viewportu na wysokość triggera (np. 36px). Przy zoom
        przeglądarki ≠ 100% albo przy mniejszych triggerach (h-8) Radix robił niespójne
        obliczenia i lista wypadała poza popover. Usuwamy h-* — Viewport sam rośnie
        z itemami do max-h ustawionego na Content (powyżej).
      */}
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
  )
})
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
