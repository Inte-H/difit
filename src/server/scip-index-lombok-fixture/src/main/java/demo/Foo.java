package demo;

import lombok.Getter;

@Getter
public class Foo {
    private boolean active;
    private String name;            // shown in the list
    private final int count = 1;

    public boolean check() {
        return active && isActive();
    }
}
