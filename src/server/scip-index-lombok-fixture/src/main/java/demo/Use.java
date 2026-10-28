package demo;

public class Use {
    public void run(Foo foo, Dat dat, Bar bar, Hand hand) {
        foo.isActive();
        foo.getName();
        foo.getCount();
        dat.getCode();
        dat.setCode("c");
        Dat.builder().code("c").build();
        bar.getTitle();
        bar.setTitle("t");
        hand.getSize();
        Ctor.builder().id("i").build();
    }
}
