declare module "ical.js" {
  export function parse(input: string): any[];

  export class Component {
    constructor(jCal: any[] | string | Component);
    addProperty(property: Property): void;
    addPropertyWithValue(
      name: string,
      value: any,
      parameters?: { [key: string]: string },
      type?: string
    ): Property;
    getFirstSubcomponent(name: string): Component | null;
    getFirstProperty(name: string): Property | null;
    toString(): string;
  }

  export class Property {
    constructor(name: string, component?: Component);
    getFirstValue(): any;
  }
}
