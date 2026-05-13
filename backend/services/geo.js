/**
 * geo.js — Pure geometry helpers for field-sales geofencing.
 *
 * No external dependencies. Used by routes/field.js to compute the distance
 * between a rep's check-in GPS coordinates and the customer's stored shop
 * location, deciding whether the visit should be flagged for owner review.
 */

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance in meters between two (lat, lng) points (haversine).
 *
 * Returns null when any coordinate is missing or non-finite — callers should
 * treat null as "geofence check impossible" and store gps_flagged=false with
 * gps_distance_m=null on the visit row (NULL ≠ pass, just means unknown).
 */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const a = Number(lat1);
  const b = Number(lng1);
  const c = Number(lat2);
  const d = Number(lng2);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) {
    return null;
  }
  const dLat = toRadians(c - a);
  const dLng = toRadians(d - b);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRadians(a)) * Math.cos(toRadians(c)) * sinLng * sinLng;
  const angular = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(EARTH_RADIUS_M * angular);
}

module.exports = { distanceMeters };
