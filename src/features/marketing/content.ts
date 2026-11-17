import {
  BriefcaseBusiness, CalendarCheck, ChartColumn, Clock, Factory, Fingerprint, GraduationCap, HardHat, Hotel, Landmark,
  Laptop, ShieldCheck, Shirt, ShoppingBag, Smartphone, Stethoscope, Target, Truck, UserPlus, Wallet, type LucideIcon,
} from 'lucide-react';
import type { FEATURE_INTERESTS, Industry } from '@shared/constants';

export const FEATURE_ICONS: Record<(typeof FEATURE_INTERESTS)[number], LucideIcon> = {
  attendance: Fingerprint,
  payroll: Wallet,
  leave: CalendarCheck,
  compliance: ShieldCheck,
  shifts: Clock,
  mobile_app: Smartphone,
  recruitment: UserPlus,
  performance: Target,
  reports: ChartColumn,
};

export const INDUSTRY_ICONS: Record<Industry, LucideIcon> = {
  manufacturing: Factory,
  textiles: Shirt,
  healthcare: Stethoscope,
  education: GraduationCap,
  retail: ShoppingBag,
  logistics: Truck,
  construction: HardHat,
  hospitality: Hotel,
  it_services: Laptop,
  finance: Landmark,
  other: BriefcaseBusiness,
};

/** Industries highlighted on the Solutions page (the rest remain selectable in forms). */
export const FEATURED_INDUSTRIES: Industry[] = ['manufacturing', 'textiles', 'healthcare', 'education', 'retail', 'logistics', 'construction', 'hospitality'];

export const SERVICE_CITIES = ['Tirunelveli', 'Thoothukudi', 'Nagercoil'] as const;
