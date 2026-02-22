# OneShopPOS User Manual

Welcome to the OneShopPOS system. This simple guide will teach you how to start the system, ring up sales, and manage your inventory.

---

## 1. Starting the System

To start the Point of Sale system for the day:

1. Double-click the `start-pos.bat` file located in the `D:\newprojects\oneshoppos\` folder.
2. Two black command windows will open (one for the backend, one for the frontend). **Do not close these.**
3. Your web browser will automatically open to the Point of Sale terminal.

---

## 2. Using the Point of Sale (Checkout)

The Point of Sale screen is designed to be fast and work automatically with your barcode scanner.

### Ringing up a Customer:

1. Ensure you are on the **Point of Sale** tab (click it on the left menu if you aren't).
2. Grab the physical item and scan its barcode with your USB scanner.
   - _Note:_ You do not need to click the search bar first. The system will automatically focus the cursor on the search box for you every second.
3. The item will instantly appear in the Cart on the left side.
4. If the customer buys two of the same item, simply scan it twice. The quantity will automatically increase.
5. If you make a mistake, click the red **Trash Can** icon next to the item to remove it from the cart.

### Checking Out:

1. Once all items are scanned, tell the customer the "Total" shown in big green letters on the right side.
2. Collect payment from the customer (Cash).
3. Click the big green **Pay & Print Receipt** button.
4. The system will automatically record the sale, deduct the items from your inventory, clear the cart for the next customer, and launch the print dialog for the receipt.

> **Caution:** If an item says "Out of stock," the system will not let you add it to the cart to prevent negative inventory errors.

---

## 3. Managing Inventory

When you receive new shipments of physical goods, you must add them to the system.

### Adding a New Item

1. Click on **Inventory** in the left menu.
2. Click the blue **+ Add New Item** button in the top right.
3. Fill out the details:
   - **Barcode:** Scan the item here, or type a custom number.
   - **Product Name:** What printing on the receipt should look like (e.g., "Coca Cola 500ml").
   - **Price:** The selling price (e.g., `1.50`).
   - **Stock Level:** The total number of this item you currently have in the store.
4. Click **Save Product**.

### Editing an Existing Item:

1. In the Inventory screen, use the search bar to find the item you want to edit.
2. Click the **Edit** button next to the item.
3. Change the price, update the stock level, or fix the name.
4. Click **Update Product**.

---

## 4. Shutting Down for the Day

When the store closes:

1. Go to the open command terminal window (the black box that says "OneShopPOS is running!").
2. Press any key on your keyboard inside that window.
3. The system will safely shut down all servers. You can now close your browser.
