import { cn } from "@/lib/utils";

interface ThothLogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  className?: string;
  animated?: boolean;
}

export function ThothLogo({ size = "md", showText = true, className, animated = false }: ThothLogoProps) {
  const sizes = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-12 w-12",
    xl: "h-16 w-16",
  };

  const textSizes = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-2xl",
    xl: "text-4xl",
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Stylized Ibis Bird - Symbol of Thoth */}
      <div className={cn(
        "relative",
        sizes[size],
        animated && "hover:scale-105 transition-transform duration-300"
      )}>
        <svg
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-full w-full"
        >
          {/* Glow effect behind the bird */}
          <defs>
            <radialGradient id="ibisGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.4" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="ibisBody" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="hsl(var(--primary))" />
              <stop offset="100%" stopColor="hsl(var(--primary) / 0.85)" />
            </linearGradient>
          </defs>
          
          {/* Subtle glow background */}
          <ellipse 
            cx="22" 
            cy="24" 
            rx="14" 
            ry="12" 
            fill="url(#ibisGlow)"
          />
          
          {/* Ibis Body - elegant curved shape */}
          <path
            d="M22 14 C28 16, 32 22, 30 30 C28 34, 24 36, 22 36 C20 36, 16 34, 14 30 C12 22, 16 16, 22 14"
            className="fill-primary"
          />
          
          {/* Elegant neck curve */}
          <path
            d="M22 14 C20 12, 18 10, 16 8 C14 6, 12 5, 10 5"
            className="stroke-primary"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
          
          {/* Head - small circle */}
          <circle
            cx="9"
            cy="5"
            r="4"
            className="fill-primary"
          />
          
          {/* Characteristic curved beak - the signature element */}
          <path
            d="M9 5 C7 6, 4 8, 2 12 C1 14, 2 15, 4 14 C6 12, 7 9, 9 7"
            className="fill-primary"
          />
          
          {/* Eye of wisdom - golden highlight */}
          <circle
            cx="10"
            cy="4.5"
            r="1.2"
            className="fill-primary-foreground"
          />
          
          {/* Inner eye detail */}
          <circle
            cx="10"
            cy="4.5"
            r="0.5"
            className="fill-primary"
          />
          
          {/* Wing detail - subtle lines */}
          <path
            d="M18 22 C20 20, 24 20, 26 22"
            className="stroke-primary-foreground/30"
            strokeWidth="1"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M17 26 C20 24, 25 24, 28 26"
            className="stroke-primary-foreground/20"
            strokeWidth="1"
            strokeLinecap="round"
            fill="none"
          />
          
          {/* Tail feather accent */}
          <path
            d="M20 34 L22 38 L24 34"
            className="stroke-primary"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col leading-none">
          <span className={cn("font-display font-bold tracking-tight text-gradient-gold", textSizes[size])}>
            thoth
            <span className="text-primary">.AI</span>
          </span>
          {size !== "sm" && (
            <span className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
              Agente Inteligente
            </span>
          )}
        </div>
      )}
    </div>
  );
}
