import { describe, it, expect } from "vitest";
import { groupCartBySeatAndCourse } from "../../src/pages/redesign/pos/restaurant/cartGrouping.js";

describe("groupCartBySeatAndCourse", () => {
  it("returns an empty array for an empty cart", () => {
    expect(groupCartBySeatAndCourse([])).toEqual([]);
  });

  it("groups items by seat then by course in stable order", () => {
    const cart = [
      { id: 1, name: "Garlic Bread", price: 100, quantity: 1, seat_number: 1, course_name: "course_1" },
      { id: 2, name: "Caesar Salad",  price: 200, quantity: 1, seat_number: 2, course_name: "course_1" },
      { id: 3, name: "Ribeye",        price: 800, quantity: 1, seat_number: 1, course_name: "course_2" },
    ];
    const groups = groupCartBySeatAndCourse(cart);
    expect(groups).toHaveLength(3);

    expect(groups[0].seat).toBe(1);
    expect(groups[0].course).toBe(1);
    expect(groups[0].items.map(i => i.id)).toEqual([1]);

    expect(groups[1].seat).toBe(1);
    expect(groups[1].course).toBe(2);
    expect(groups[1].items.map(i => i.id)).toEqual([3]);

    expect(groups[2].seat).toBe(2);
    expect(groups[2].course).toBe(1);
    expect(groups[2].items.map(i => i.id)).toEqual([2]);
  });

  it("computes subtotal as sum of price × quantity per group", () => {
    const cart = [
      { id: 1, price: 100, quantity: 2, seat_number: 1, course_name: "course_1" },
      { id: 2, price: 50,  quantity: 3, seat_number: 1, course_name: "course_1" },
    ];
    const [group] = groupCartBySeatAndCourse(cart);
    expect(group.subtotal).toBe(100 * 2 + 50 * 3);
    expect(group.itemCount).toBe(5);
  });

  it("derives course number from course_name like 'course_3'", () => {
    const cart = [{ id: 1, price: 10, quantity: 1, seat_number: 2, course_name: "course_3" }];
    const [group] = groupCartBySeatAndCourse(cart);
    expect(group.course).toBe(3);
  });

  it("treats null seat as seat 0 (un-seated bucket)", () => {
    const cart = [
      { id: 1, price: 10, quantity: 1, seat_number: null, course_name: "course_1" },
      { id: 2, price: 10, quantity: 1, seat_number: 1,    course_name: "course_1" },
    ];
    const groups = groupCartBySeatAndCourse(cart);
    expect(groups.map(g => g.seat)).toEqual([0, 1]);
  });

  it("falls back to course 1 when course_name is missing or 'main'", () => {
    const cart = [
      { id: 1, price: 10, quantity: 1, seat_number: 1, course_name: "main" },
      { id: 2, price: 10, quantity: 1, seat_number: 1 },
    ];
    const groups = groupCartBySeatAndCourse(cart);
    expect(groups).toHaveLength(1);
    expect(groups[0].course).toBe(1);
    expect(groups[0].items).toHaveLength(2);
  });
});
