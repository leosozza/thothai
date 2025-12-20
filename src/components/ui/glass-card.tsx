import * as React from "react";
import { cn } from "@/lib/utils";

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  glow?: boolean;
  hover?: boolean;
}

const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, glow = false, hover = true, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl p-6",
        hover ? "glass-card-hover" : "glass-card",
        glow && "glow-primary-sm",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);
GlassCard.displayName = "GlassCard";

interface GlassCardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

const GlassCardHeader = React.forwardRef<HTMLDivElement, GlassCardHeaderProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-1.5 mb-4", className)}
      {...props}
    />
  )
);
GlassCardHeader.displayName = "GlassCardHeader";

interface GlassCardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}

const GlassCardTitle = React.forwardRef<HTMLHeadingElement, GlassCardTitleProps>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("text-lg font-semibold leading-none tracking-tight text-foreground", className)}
      {...props}
    />
  )
);
GlassCardTitle.displayName = "GlassCardTitle";

interface GlassCardDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {}

const GlassCardDescription = React.forwardRef<HTMLParagraphElement, GlassCardDescriptionProps>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
);
GlassCardDescription.displayName = "GlassCardDescription";

interface GlassCardContentProps extends React.HTMLAttributes<HTMLDivElement> {}

const GlassCardContent = React.forwardRef<HTMLDivElement, GlassCardContentProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("", className)} {...props} />
  )
);
GlassCardContent.displayName = "GlassCardContent";

interface GlassCardIconProps extends React.HTMLAttributes<HTMLDivElement> {}

const GlassCardIcon = React.forwardRef<HTMLDivElement, GlassCardIconProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "h-12 w-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);
GlassCardIcon.displayName = "GlassCardIcon";

export {
  GlassCard,
  GlassCardHeader,
  GlassCardTitle,
  GlassCardDescription,
  GlassCardContent,
  GlassCardIcon,
};
