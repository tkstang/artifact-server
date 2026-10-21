import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** Multi-line text control matching the boxed input treatment. */
function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-20 w-full min-w-0 resize-y rounded-md border border-input bg-background px-3 py-2 text-base leading-6 transition-[color,border-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:aria-invalid:border-destructive/50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
