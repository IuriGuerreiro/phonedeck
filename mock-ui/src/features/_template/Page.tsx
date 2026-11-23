import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getItems, type Item } from "./mock";

export default function Page() {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    getItems().then(setItems);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>New feature</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {items === null ? "Loading…" : items.map((i) => <div key={i.id}>{i.name}</div>)}
      </CardContent>
    </Card>
  );
}
