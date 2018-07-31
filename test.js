class A {
    constructor() {
        this.test = "A";
    }
    exec() { console.log(this); }
};
let a = new A();
a.exec();
a.exec = function exec() { console.log(this, this.test); }
a.exec();
