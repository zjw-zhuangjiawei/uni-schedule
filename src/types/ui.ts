export interface ComponentProps {
  className?: string;
  style?: React.CSSProperties;
}

export interface PanelProps extends ComponentProps {
  open: boolean;
  onClose: () => void;
}

export interface FormProps {
  onSubmit: (event: React.FormEvent) => void;
  isSubmitting?: boolean;
}

export interface ButtonProps extends ComponentProps {
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "secondary" | "danger";
  size?: "small" | "medium" | "large";
}
