import { cn } from "@/lib/utils";

interface ThothLogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  className?: string;
  animated?: boolean;
}

export function ThothLogo({ size = "md", showText = true, className, animated = false }: ThothLogoProps) {
  const sizes = {
    sm: "h-8 w-8",
    md: "h-10 w-10",
    lg: "h-14 w-14",
    xl: "h-20 w-20",
  };

  const textSizes = {
    sm: "text-xl",
    md: "text-2xl",
    lg: "text-3xl",
    xl: "text-5xl",
  };

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {/* Minimalist Line Art Ibis - THOTH24 Style */}
      <div className={cn(
        "relative flex items-center justify-center",
        sizes[size],
        animated && "hover:scale-105 transition-transform duration-300"
      )}>
        <svg
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-full w-full"
        >
          {/* Outer glow circle */}
          <circle
            cx="24"
            cy="24"
            r="22"
            className="stroke-primary/20"
            strokeWidth="1"
            fill="none"
          />
          
          {/* Ibis silhouette - minimalist line art */}
          <g className="stroke-primary" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
            {/* Body - elegant curved shape */}
            <path d="M24 38 C18 36, 14 30, 16 22 C18 16, 22 14, 26 14 C30 14, 34 18, 34 24 C34 30, 30 36, 24 38" />
            
            {/* Long curved neck */}
            <path d="M22 14 C20 12, 16 10, 12 8" />
            
            {/* Head */}
            <circle cx="11" cy="7" r="3" />
            
            {/* Curved beak - signature element */}
            <path d="M8 7 C6 9, 4 12, 3 15" />
            
            {/* Eye dot */}
            <circle cx="10.5" cy="6.5" r="0.8" className="fill-primary stroke-none" />
            
            {/* Wing detail lines */}
            <path d="M20 24 C22 22, 28 22, 30 24" />
            <path d="M19 28 C22 26, 29 26, 32 28" />
            
            {/* Tail feathers */}
            <path d="M22 36 L24 42" />
            <path d="M26 36 L24 42" />
          </g>
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col leading-none">
          <span className={cn(
            "font-display font-bold tracking-tight",
            textSizes[size]
          )}>
            <span className="text-gradient-primary">THOTH</span>
            <span className="text-primary">24</span>
          </span>
          {size !== "sm" && (
            <span className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground mt-0.5">
              Parceiro Bitrix24
            </span>
          )}
        </div>
      )}
    </div>
  );
}
