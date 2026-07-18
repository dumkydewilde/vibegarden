import {
  Apple,
  Flower2,
  Home,
  Images,
  Sprout,
  TreeDeciduous,
  UserCog,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

export const navItems: NavItem[] = [
  { to: "", label: "Home", icon: Home },
  { to: "garden", label: "Idea Garden", icon: Sprout },
  { to: "learning", label: "Learning", icon: TreeDeciduous },
  { to: "artifacts", label: "Artifacts", icon: Apple },
  { to: "gallery", label: "Gallery", icon: Images },
  { to: "inspiration", label: "Inspiration", icon: Flower2 },
  { to: "admin", label: "Admin", icon: UserCog, adminOnly: true },
];
