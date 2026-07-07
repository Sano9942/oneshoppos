// Display names for tenant industry presets + modes, mirrored from
// backend/config/industry-config.js (INDUSTRY_PRESETS[].display_name) and
// backend/config/mode-registry.js. Keep in sync when adding a preset/mode.

export const INDUSTRY_LABELS = {
  general_retail: "Retail Store",
  restaurant: "Restaurant",
  salon: "Salon / Services",
  grocery: "Grocery / Supermarket",
  cafe: "Cafe / Counter",
  clinic: "Clinic / Practice",
  repair_shop: "Repair / Service Shop",
  gym: "Gym / Fitness",
  wholesale: "Wholesale / Distribution",
  photography_studio: "Photography Studio",
  butcher: "Butcher / Meat Shop",
  sweet_shop: "Sweet Shop / Mithai",
  textile: "Textile / Fabric",
  car_rental: "Car Rental",
  equipment_hire: "Equipment Hire",
  furniture_rental: "Furniture / Events Rental",
  party_supplies: "Party Supplies Rental",
  hotel: "Hotel",
  guesthouse: "Guesthouse",
  hostel: "Hostel",
  dental_clinic: "Dental Clinic",
  veterinary: "Veterinary Practice",
  physiotherapy: "Physiotherapy Clinic",
};

export const MODE_LABELS = {
  restaurant: "Restaurant",
  appointments: "Appointments",
  commissions: "Commissions",
  service_projects: "Projects",
  subscriptions: "Subscriptions",
  workflow_tickets: "Tickets",
  rentals: "Rentals",
  room_management: "Rooms",
  treatment_plans: "Treatment plans",
  wholesale: "Wholesale",
};

export function industryLabel(key) {
  return key ? (INDUSTRY_LABELS[key] || key) : "—";
}
