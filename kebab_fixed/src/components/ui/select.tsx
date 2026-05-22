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
}, ref) => (
  // === DLACZEGO TE PROPSY ===
  //
  // Triggery Selecta w naszych modalach (np. ClientOrdersPage > "Nowe zamówienie")
  // siedzą wewnątrz `<div max-h-[75vh] overflow-y-auto>` w DialogContent który ma
  // `transform: translate(-50%,-50%)`. Radix `position="popper"` używa floating-ui,
  // a floating-ui w połączeniu z (transformed ancestor + scroll-container + zoom
  // przeglądarki ≠ 100%) potrafi "shiftować" popover w dół (collision-avoidance
  // myśli że trafi w krawędź) → opcje pojawiają się 100-200px poniżej triggera,
  // w środku formularza, "luzem". Item-aligned z kolei próbował przyłożyć
  // zaznaczoną opcję NAD triggerem — przy triggerach blisko górnej krawędzi
  // dialogu lista uciekała w górę.
  //
  // Rozwiązanie: zostaje `popper` (najbardziej przewidywalny), ale wyłączamy
  // collision-avoidance i pinujemy popover deterministycznie pod triggerem
  // (side=bottom, align=start). Jeśli się nie zmieści w dół, lepiej żeby się
  // przewinął (overflow z max-h niżej) niż żeby "uciekał" gdzie indziej.
  //
  // NIE nakładamy własnych `translate-*` w className — floating-ui ustawia inline
  // `transform: translate3d(...)` i każda klasa CSS z transform jest i tak
  // nadpisana (inline > rules). Animacje slide-from-* właśnie tym translate'em
  // zaśmiecały i przy zoom 150% gubiły subpixel-math. Zostają fade + zoom (te
  // używają transform-origin, nie translate, więc współgrają z floating-ui).
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
))
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
