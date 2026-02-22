async function testBrands() {
    try {
        const res = await fetch('http://localhost:5000/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                barcode: 'BR-TEST-API-2',
                name: 'API Brand Test Item 2',
                price: 100,
                stock: 10,
                brand_id: 2
            })
        });
        
        const data = await res.json();
        console.log("POST Result:", data);
        
        const res2 = await fetch('http://localhost:5000/api/products');
        const data2 = await res2.json();
        const item = data2.products.find(p => p.barcode === 'BR-TEST-API-2');
        console.log("Found Item via GET:", item);
    } catch(err) {
        console.error(err);
    }
}
testBrands();
